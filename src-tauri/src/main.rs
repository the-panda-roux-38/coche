// Coche — une petite to-do list motivante.
// Côté Rust : sauvegarde des données, icône dans la barre des tâches,
// lancement au démarrage, raccourci global et notifications aléatoires.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{Local, NaiveDate, Timelike};
use rand::{seq::SliceRandom, Rng};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::Path, path::PathBuf, sync::Mutex, thread, time::Duration};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewWindow, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

// ---------------------------------------------------------------------------
// Données (on ne lit que ce dont on a besoin pour les notifications ;
// le reste est géré par l'interface et sauvegardé tel quel)
// ---------------------------------------------------------------------------

#[derive(Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
struct Task {
    text: String,
    done: bool,
    done_at: Option<String>,
    focus: bool,
}

#[derive(Deserialize, Clone, PartialEq)]
#[serde(default, rename_all = "camelCase")]
struct Settings {
    notif_per_day: u32,
    start_hour: u32,
    end_hour: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { notif_per_day: 3, start_hour: 9, end_hour: 21 }
    }
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Snapshot {
    tasks: Vec<Task>,
    settings: Settings,
}

fn snapshot(data: &Value) -> Snapshot {
    serde_json::from_value(data.clone()).unwrap_or_default()
}

/// Messages des notifications — modifiables dans messages.json
#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
struct Messages {
    defi: Vec<String>,
    boost: Vec<String>,
    bravo: Vec<String>,
    focus: Vec<String>,
    fini: Vec<String>,
}

impl Default for Messages {
    fn default() -> Self {
        let v = |items: &[&str]| items.iter().map(|s| s.to_string()).collect();
        Messages {
            defi: v(&[
                "Et si tu faisais « {tache} » maintenant ?",
                "Petit défi : « {tache} ». Tu te lances ?",
                "Allez ! « {tache} » t'attend. Ça prendra peut-être 5 minutes.",
                "Tirage au sort du moment : « {tache} ». À toi de jouer !",
            ]),
            boost: v(&[
                "Plus que {restant} sur ta liste. Une de plus et ça descend !",
                "{restant} petites choses à faire. Commence par la plus facile !",
                "Une tâche à la fois, c'est comme ça qu'on avance.",
            ]),
            bravo: v(&[
                "Déjà {fait} aujourd'hui, beau travail !",
                "Compteur du jour : {fait} ✓. Tu es lancé·e !",
                "{fait} de faites aujourd'hui. On continue sur cette lancée ?",
            ]),
            focus: v(&[
                "Ta tâche du jour : « {tache} ». C'est le bon moment ?",
                "Rappel tranquille : « {tache} » est ta priorité du jour.",
            ]),
            fini: v(&[
                "Tout est coché ! Profite de ce moment 🎉",
                "Liste terminée. Tu peux être fier·e de toi !",
            ]),
        }
    }
}

fn load_messages(path: &Path) -> Messages {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => {
            let m = Messages::default();
            if let Ok(text) = serde_json::to_string_pretty(&m) {
                let _ = fs::write(path, text);
            }
            m
        }
    }
}

struct Store {
    data: Mutex<Value>,
    path: PathBuf,
    messages_path: PathBuf,
}

fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn tooltip(pending: usize) -> String {
    match pending {
        0 => "Coche — tout est fait !".into(),
        1 => "Coche — 1 chose à faire".into(),
        n => format!("Coche — {n} choses à faire"),
    }
}

// ---------------------------------------------------------------------------
// Construction d'un message motivant à partir de l'état des listes
// ---------------------------------------------------------------------------

fn build_message(snap: &Snapshot, m: &Messages) -> Option<String> {
    let today = today();
    let pending: Vec<&Task> = snap
        .tasks
        .iter()
        .filter(|t| !t.done && !t.text.trim().is_empty())
        .collect();
    let fait = snap
        .tasks
        .iter()
        .filter(|t| t.done && t.done_at.as_deref() == Some(today.as_str()))
        .count();
    let mut rng = rand::thread_rng();

    let (pool, tache): (&Vec<String>, String) = if pending.is_empty() {
        if fait == 0 {
            return None; // liste vide et rien fait : on ne dérange pas
        }
        (&m.fini, String::new())
    } else {
        let focus = pending.iter().find(|t| t.focus);
        let mut kinds = vec!["defi", "defi", "boost"];
        if fait > 0 {
            kinds.push("bravo");
        }
        if focus.is_some() {
            kinds.extend(["focus", "focus"]);
        }
        match *kinds.choose(&mut rng).unwrap() {
            "focus" => (&m.focus, focus.unwrap().text.clone()),
            "boost" => (&m.boost, String::new()),
            "bravo" => (&m.bravo, String::new()),
            _ => (&m.defi, pending.choose(&mut rng).unwrap().text.clone()),
        }
    };

    let tpl = pool.choose(&mut rng)?;
    Some(
        tpl.replace("{tache}", tache.trim())
            .replace("{restant}", &pending.len().to_string())
            .replace("{fait}", &fait.to_string()),
    )
}

fn notify(app: &AppHandle, body: &str) {
    let _ = app.notification().builder().title("Coche").body(body).show();
}

// ---------------------------------------------------------------------------
// Planification des notifications aléatoires
// La plage horaire est découpée en N segments ; une heure est tirée
// au hasard dans chaque segment → aléatoire mais bien réparti.
// ---------------------------------------------------------------------------

fn plan_slots(s: &Settings, now_min: u32) -> Vec<u32> {
    let start = s.start_hour.min(23) * 60;
    let end = s.end_hour.min(24) * 60;
    if s.notif_per_day == 0 || end <= start {
        return vec![];
    }
    let lo = start.max(now_min + 5);
    if lo + 15 >= end {
        return vec![];
    }
    // Si l'appli démarre en cours de journée, on garde la même densité
    let frac = (end - lo) as f64 / (end - start) as f64;
    let n = ((s.notif_per_day as f64) * frac).round().clamp(0.0, 12.0) as usize;
    if n == 0 {
        return vec![];
    }
    let mut rng = rand::thread_rng();
    let seg = (end - lo) as f64 / n as f64;
    (0..n)
        .map(|i| {
            let a = lo as f64 + seg * i as f64;
            let margin = seg * 0.15;
            rng.gen_range((a + margin)..(a + seg - margin)) as u32
        })
        .collect()
}

fn start_scheduler(app: AppHandle) {
    thread::spawn(move || {
        let mut plan_date: Option<NaiveDate> = None;
        let mut plan_settings: Option<Settings> = None;
        let mut slots: Vec<u32> = vec![];
        loop {
            thread::sleep(Duration::from_secs(20));
            let store = app.state::<Store>();
            let snap = snapshot(&store.data.lock().unwrap());
            let now = Local::now();
            let date = now.date_naive();
            let minute = now.hour() * 60 + now.minute();

            if plan_date != Some(date) || plan_settings.as_ref() != Some(&snap.settings) {
                slots = plan_slots(&snap.settings, minute);
                plan_date = Some(date);
                plan_settings = Some(snap.settings.clone());
            }

            if let Some(&next) = slots.first() {
                if minute >= next {
                    slots.remove(0);
                    // Pas de notification si la fenêtre est déjà ouverte et active
                    let busy = app
                        .get_webview_window("main")
                        .map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false))
                        .unwrap_or(false);
                    if !busy {
                        let messages = load_messages(&store.messages_path);
                        if let Some(msg) = build_message(&snap, &messages) {
                            notify(&app, &msg);
                        }
                    }
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Fenêtre
// ---------------------------------------------------------------------------

fn show_main(app: &AppHandle, quick_add: bool) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        if quick_add {
            let _ = w.emit("quick-add", ());
        }
    }
}

fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show_main(app, false);
        }
    }
}

// ---------------------------------------------------------------------------
// Commandes appelées depuis l'interface
// ---------------------------------------------------------------------------

#[tauri::command]
fn load_data(store: State<Store>) -> Value {
    store.data.lock().unwrap().clone()
}

#[tauri::command]
fn save_data(app: AppHandle, store: State<Store>, data: Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    let tmp = store.path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &store.path).map_err(|e| e.to_string())?;

    let pending = snapshot(&data).tasks.iter().filter(|t| !t.done).count();
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(tooltip(pending)));
    }
    *store.data.lock().unwrap() = data;
    Ok(())
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    result.map_err(|e| e.to_string())
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn test_notification(app: AppHandle, store: State<Store>) {
    let snap = snapshot(&store.data.lock().unwrap());
    let messages = load_messages(&store.messages_path);
    let msg = build_message(&snap, &messages)
        .unwrap_or_else(|| "Coche est prêt à te motiver !".to_string());
    notify(&app, &msg);
}

#[tauri::command]
fn open_messages(app: AppHandle, store: State<Store>) -> Result<(), String> {
    load_messages(&store.messages_path); // crée le fichier s'il n'existe pas
    app.opener()
        .open_path(store.messages_path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_window(window: WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Lance le désinstalleur « sur place » puis quitte Coche.
/// Le désinstalleur NSIS se recopie normalement dans le dossier temporaire avant
/// de démarrer, et le contrôle intelligent des applications de Windows 11 bloque
/// cette copie non signée. L'option `_?=` le fait tourner directement depuis son dossier.
#[tauri::command]
fn uninstall_app(app: AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("Dossier de Coche introuvable")?.to_path_buf();
    let uninstaller = dir.join("uninstall.exe");
    if !uninstaller.exists() {
        return Err("Désinstalleur introuvable : Coche n'a pas été installé avec l'installateur.".into());
    }
    let mut cmd = std::process::Command::new(&uninstaller);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // `_?=` doit rester le dernier argument, sans guillemets, même si le chemin contient des espaces
        cmd.raw_arg(format!("/FROMAPP _?={}", dir.display()));
    }
    #[cfg(not(windows))]
    cmd.arg("/FROMAPP");
    cmd.spawn().map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

// ---------------------------------------------------------------------------

fn main() {
    tauri::Builder::default()
        // Une seule instance : relancer Coche ré-affiche la fenêtre existante
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app, false);
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Données
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            let path = dir.join("data.json");
            let first_run = !path.exists();
            let data = fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(Value::Null);
            let messages_path = dir.join("messages.json");
            load_messages(&messages_path);
            let pending = snapshot(&data).tasks.iter().filter(|t| !t.done).count();
            app.manage(Store { data: Mutex::new(data), path, messages_path });

            // Lancement au démarrage activé par défaut (version installée uniquement)
            if first_run && !cfg!(debug_assertions) {
                let _ = app.autolaunch().enable();
            }

            // Raccourci global Ctrl+Alt+H → ajout rapide
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _shortcut, event| {
                        if event.state() == ShortcutState::Pressed {
                            show_main(app, true);
                        }
                    })
                    .build(),
            )?;
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyH);
            if let Err(e) = app.global_shortcut().register(shortcut) {
                eprintln!("Raccourci Ctrl+Alt+H indisponible : {e}");
            }

            // Icône dans la barre des tâches
            let open = MenuItem::with_id(app, "open", "Ouvrir Coche", true, None::<&str>)?;
            let add = MenuItem::with_id(app, "add", "Nouvelle tâche", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &add, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip(tooltip(pending))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app, false),
                    "add" => show_main(app, true),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main(tray.app_handle());
                    }
                })
                .build(app)?;

            start_scheduler(app.handle().clone());
            Ok(())
        })
        // Fermer la fenêtre la range dans la barre des tâches au lieu de quitter
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            set_autostart,
            get_autostart,
            test_notification,
            open_messages,
            hide_window,
            quit_app,
            uninstall_app
        ])
        .run(tauri::generate_context!())
        .expect("Impossible de lancer Coche");
}

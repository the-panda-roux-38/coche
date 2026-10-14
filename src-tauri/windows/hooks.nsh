; Coche — ajustements de l'installateur Windows
;
; Le contrôle intelligent des applications de Windows 11 (Smart App Control) bloque
; la copie temporaire que le désinstalleur NSIS fait de lui-même. On propose donc
; deux chemins qui lancent le désinstalleur « sur place » (option _?=) :
;   - Réglages de Coche → « Désinstaller Coche »
;   - Menu Démarrer → « Désinstaller Coche »
; Ces deux chemins passent /FROMAPP pour qu'on fasse le ménage à la fin.

!macro NSIS_HOOK_POSTINSTALL
  CreateShortCut "$SMPROGRAMS\Désinstaller Coche.lnk" "$INSTDIR\uninstall.exe" "/FROMAPP _?=$INSTDIR" "$INSTDIR\uninstall.exe" 0
!macroend

; Avant de désinstaller : ferme Coche s'il tourne en arrière-plan (près de l'horloge),
; sinon la désinstallation est bloquée.
!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /IM coche.exe /F'
  Pop $0
  Sleep 800
!macroend

; Après la désinstallation (pas pendant une mise à jour)
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    ; Retire le lancement au démarrage
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Coche"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Coche"
    Delete "$SMPROGRAMS\Désinstaller Coche.lnk"

    ; Lancé sur place, le désinstalleur ne peut pas s'effacer lui-même :
    ; une commande invisible le supprime, avec le dossier, deux secondes plus tard.
    ClearErrors
    ${GetOptions} $CMDLINE "/FROMAPP" $R9
    ${IfNot} ${Errors}
      ExecShell "open" "$SYSDIR\cmd.exe" '/c ping -n 3 127.0.0.1 >nul & del /f /q "$INSTDIR\uninstall.exe" & rmdir "$INSTDIR"' SW_HIDE
    ${EndIf}
  ${EndIf}
!macroend

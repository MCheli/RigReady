; RigReady's additions to the electron-builder NSIS installer and uninstaller.
;
; - The installer never offers "for all users": that would need administrator rights.
; - The uninstaller removes the "start with Windows" entry of the install it removes,
;   and asks whether to remove the user's data too. The default is to keep it, a silent
;   uninstall (/S) keeps it, and an update never touches either.
;   A scripted uninstall that should also remove the data:
;     "Uninstall RigReady.exe" /S --remove-data

!ifndef RIGREADY_DATA_FOLDER
  ; Below the user's profile folder, unless RIGREADY_HOME names another place.
  !define RIGREADY_DATA_FOLDER ".rigready"
!endif
!ifndef RIGREADY_RUN_VALUE
  ; The name of the per-user Run entry the app writes (ElectronLoginItem).
  !define RIGREADY_RUN_VALUE "RigReady"
!endif

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; ---- start with Windows: only the entry that starts this install ----
    ReadRegStr $R7 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${RIGREADY_RUN_VALUE}"
    ${if} $R7 != ""
      StrCpy $R8 $R7 1
      ${if} $R8 == '"'
        StrCpy $R7 $R7 "" 1
      ${endIf}
      StrLen $R8 "$INSTDIR\"
      StrCpy $R9 $R7 $R8
      ${if} $R9 == "$INSTDIR\"
        DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${RIGREADY_RUN_VALUE}"
        DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${RIGREADY_RUN_VALUE}"
      ${endIf}
    ${endIf}

    ; ---- the installer copy kept for updates (it is of no use without the app) ----
    !ifdef APP_PACKAGE_NAME
      ${if} ${FileExists} "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater\installer.exe"
        RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
      ${endIf}
    !endif

    ; ---- the user's data: kept unless asked otherwise ----
    ReadEnvStr $R7 "RIGREADY_HOME"
    ${if} $R7 == ""
      StrCpy $R7 "$PROFILE\${RIGREADY_DATA_FOLDER}"
    ${endIf}
    StrCpy $R8 "0"
    ${GetParameters} $R9
    ClearErrors
    ${GetOptions} $R9 "--remove-data" $R6
    ${ifNot} ${Errors}
      StrCpy $R8 "1"
    ${else}
      ${ifNot} ${Silent}
        ${if} ${FileExists} "$R7\*.*"
          MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also remove your RigReady data?$\r$\n$\r$\nYour setups, backups, settings and logs are in:$\r$\n$R7$\r$\n$\r$\nChoose No to keep them, for example to install RigReady again later." /SD IDNO IDNO rigreadyKeepData
          StrCpy $R8 "1"
          rigreadyKeepData:
        ${endIf}
      ${endIf}
    ${endIf}
    ClearErrors
    ${if} $R8 == "1"
      ; Only ever a folder RigReady itself has used: it has the app's log in it.
      ${if} ${FileExists} "$R7\logs\rigready.log"
        RMDir /r "$R7"
      ${endIf}
    ${endIf}
  ${endIf}
!macroend

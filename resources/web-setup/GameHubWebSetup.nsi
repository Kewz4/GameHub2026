; GameHub web setup — a ~1 MB bootstrapper that downloads the real app from
; GitHub releases at install time, so the initial download is tiny. Offers a
; choice between a normal installation (fetches the full NSIS installer and
; runs it) and a portable copy (fetches the portable zip, extracts it to a
; folder of the user's choice and drops the "portable" marker).
;
; Compiled in CI with the stock makensis on the Windows runner — no NSIS
; download plugins are used; networking is delegated to an embedded PowerShell
; script (websetup.ps1), which every supported Windows ships with.

!include "MUI2.nsh"
!include "nsDialogs.nsh"

Name "GameHub"
OutFile "..\..\dist\GameHub-WebSetup.exe"
Unicode True
RequestExecutionLevel user
SetCompressor /SOLID lzma
InstallDir "$LOCALAPPDATA\Programs\GameHub Portable"

!define MUI_ICON "..\..\build\icon.ico"

Var Mode              ; "install" | "portable"
Var ModeDialog
Var RadioInstall
Var RadioPortable

; ---------- Pages ----------
Page custom ModePageCreate ModePageLeave
; Directory page only applies to portable mode (install delegates to the full
; installer, which has its own flow).
!define MUI_PAGE_CUSTOMFUNCTION_PRE DirectoryPagePre
!define MUI_DIRECTORYPAGE_TEXT_TOP "Choose the folder for your portable GameHub. Everything (app + saves + settings) stays inside this folder."
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function ModePageCreate
  !insertmacro MUI_HEADER_TEXT "Choose setup type" "GameHub will be downloaded from the latest release (a few hundred MB)."
  nsDialogs::Create 1018
  Pop $ModeDialog

  ${NSD_CreateRadioButton} 10u 20u 280u 12u "&Install GameHub (recommended)"
  Pop $RadioInstall
  ${NSD_CreateLabel} 22u 34u 260u 20u "Downloads the full installer and runs it. Updates automatically."

  ${NSD_CreateRadioButton} 10u 60u 280u 12u "&Portable copy"
  Pop $RadioPortable
  ${NSD_CreateLabel} 22u 74u 260u 20u "Extracts GameHub into a folder you pick (USB-friendly). All data stays in that folder."

  ${NSD_Check} $RadioInstall
  nsDialogs::Show
FunctionEnd

Function ModePageLeave
  ${NSD_GetState} $RadioPortable $0
  ${If} $0 = ${BST_CHECKED}
    StrCpy $Mode "portable"
  ${Else}
    StrCpy $Mode "install"
  ${EndIf}
FunctionEnd

Function DirectoryPagePre
  ${If} $Mode != "portable"
    Abort ; skip the folder page — the full installer asks its own questions
  ${EndIf}
FunctionEnd

; ---------- Work ----------
Section "Download and set up"
  InitPluginsDir
  SetOutPath $PLUGINSDIR
  File "websetup.ps1"

  ${If} $Mode == "portable"
    DetailPrint "Setting up portable GameHub in $INSTDIR"
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\websetup.ps1" -Mode portable -Dir "$INSTDIR"'
  ${Else}
    DetailPrint "Downloading the GameHub installer"
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\websetup.ps1" -Mode install'
  ${EndIf}
  Pop $0
  ${If} $0 != 0
    DetailPrint "Setup failed (exit code $0). Check your internet connection and try again."
    Abort "Download failed — please check your connection and retry."
  ${EndIf}
SectionEnd

; Runs after every NSIS install/update.
; NOTE: We deliberately DO NOT write the .gamehub-setup marker or create
; shortcuts here. The setup.exe only unpacks the app into its staging folder;
; the in-app wizard (installer.tsx) then asks the user to pick Portable or
; Installation and a destination folder, and it owns the marker + shortcuts.
; (Existing installs are detected via their userData at startup, so the wizard
; never re-appears after an NSIS auto-update.)
!macro customInstall
  ; ── When the user runs Setup.exe manually (NOT a silent auto-update), drop a
  ;    flag so the app shows the Portable/Install wizard on launch even if they
  ;    already have data. Silent updates (electron-updater runs with /S) skip
  ;    this, so background updates never pop the wizard. ──
  ${IfNot} ${Silent}
    FileOpen $0 "$INSTDIR\.gamehub-show-wizard" w
    FileClose $0
  ${EndIf}

  ; ── Purge per-user icon cache so the new icon shows immediately ──
  Delete /REBOOTOK "$LOCALAPPDATA\IconCache.db"

  ; iconcache_*.db — Delete does not support wildcards; use FindFirst/FindNext
  FindFirst $0 $1 "$LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache_*.db"
  ${While} $1 != ""
    Delete /REBOOTOK "$LOCALAPPDATA\Microsoft\Windows\Explorer\$1"
    FindNext $0 $1
  ${EndWhile}
  FindClose $0

  ; Win10/11: rebuild the icon cache ("-show" is the modern rebuild flag)
  ExecWait '"$SYSDIR\ie4uinit.exe" -show'

  ; Notify the shell that icons/associations changed
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

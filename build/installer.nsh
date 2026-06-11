; Runs after every NSIS install/update.
!macro customInstall
  ; ── 1. Write setup marker so needsSetup() stays false after updates ──
  FileOpen $0 "$INSTDIR\.gamehub-setup" w
  FileClose $0

  ; ── 2. Recreate shortcuts to $INSTDIR so stale shortcuts from any prior
  ;       install location (e.g. our custom installer at %LOCALAPPDATA%\GameHub)
  ;       are replaced with the correct NSIS install path. ──
  SetShellVarContext current
  CreateShortcut "$DESKTOP\GameHub.lnk" "$INSTDIR\GameHub.exe"
  CreateShortcut "$SMPROGRAMS\GameHub.lnk" "$INSTDIR\GameHub.exe"

  ; ── 3. Purge per-user icon cache so the new icon shows immediately ──
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

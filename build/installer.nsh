; Rebuild icon cache and stamp the setup marker after every install/update.
; The marker prevents the setup wizard from re-appearing on auto-updates.
!macro customInstall
  ; ── Write setup marker so needsSetup() returns false after updates ──
  FileOpen $0 "$INSTDIR\.gamehub-setup" w
  FileClose $0

  ; ── Purge per-user icon cache so the new exe icon shows immediately ──
  ; IconCache.db (root)
  Delete /REBOOTOK "$LOCALAPPDATA\IconCache.db"

  ; Explorer iconcache_*.db — NSIS Delete does not support wildcards,
  ; so enumerate with FindFirst / FindNext.
  FindFirst $0 $1 "$LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache_*.db"
  ${While} $1 != ""
    Delete /REBOOTOK "$LOCALAPPDATA\Microsoft\Windows\Explorer\$1"
    FindNext $0 $1
  ${EndWhile}
  FindClose $0

  ; Win10/11: trigger a cache rebuild ("-show" is the modern flag)
  ExecWait '"$SYSDIR\ie4uinit.exe" -show'

  ; Notify the shell that file associations / icons changed
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

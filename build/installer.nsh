; Rebuild the Windows icon cache after install/update so the new exe icon
; shows on shortcuts and the taskbar. SHChangeNotify alone is not enough on
; Win10/11 — the cache DBs must be purged and ie4uinit must rebuild them.
!macro customInstall
  ; Purge the per-user icon cache databases (locked files are skipped)
  Delete /REBOOTOK "$LOCALAPPDATA\IconCache.db"
  Delete /REBOOTOK "$LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache_*.db"
  ; Win10/11: rebuild the icon cache ("-show" is the modern flag;
  ; "-ClearIconCache" is a no-op on these versions)
  ExecWait '"$SYSDIR\ie4uinit.exe" -show'
  ; Notify the shell that icons/associations changed (SHCNE_ASSOCCHANGED)
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

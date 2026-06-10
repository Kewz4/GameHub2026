; Refresh the Windows icon cache after install/update so the app icon
; shows correctly without requiring an Explorer restart.
!macro customInstall
  nsExec::ExecToLog '"$SYSDIR\ie4uinit.exe" -ClearIconCache'
  nsExec::ExecToLog '"$SYSDIR\ie4uinit.exe" -show'
!macroend

; Kaldırırken "Windows ile başlat" kaydını da temizle
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NooXTabs"
!macroend

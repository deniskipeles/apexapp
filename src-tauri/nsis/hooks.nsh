!macro customInstall
  # $INSTDIR is the installation directory (e.g., C:\Program Files\apexapp)
  FileOpen $0 "$INSTDIR\.env" w
  FileWrite $0 'APEXKIT_MASTER_KEY="CScyV/ruJ2Evl9c3tNvSQpZ3pKctbPiu8P+5gjJwa+w="'
  FileClose $0
  DetailPrint "Configured ApexKit Master Key in .env"
!macroend
@echo off
rem Opens the job-hunting Chrome profile at logon so the Claude in Chrome extension is connected
rem and the attended session can drive it (spec §2). Set PROFILE to the "Profile Path" folder
rem name shown at chrome://version for that profile (e.g. Default, Profile 1, Profile 2).
set "PROFILE=Profile 4"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo Chrome not found under Program Files or LocalAppData & exit /b 1
)
start "" "%CHROME%" --profile-directory="%PROFILE%"

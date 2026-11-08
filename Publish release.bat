@echo off
setlocal
cd /d "%~dp0"
echo Tyro-Shelf: publish a new release
echo.
where git >nul 2>nul || (echo Git is not installed. & pause & goto :eof)
rem first-time setup: the GitHub address, and a name for the commits (a private GitHub address, no real email)
git remote get-url origin >nul 2>nul || git remote add origin https://github.com/tyronetyronia111-debug/TyroShelf.git
git config user.email >nul 2>nul || git config user.email "tyronetyronia111-debug@users.noreply.github.com"
git config user.name >nul 2>nul || git config user.name "tyronetyronia111-debug"
git config core.autocrlf false
git branch -M main
for /f "delims=" %%t in ('git tag --sort=-v:refname') do (set LAST=%%t& goto :got)
:got
echo Last release tag: %LAST%
set /p NUM=New release number (just the number, higher than the last, e.g. 25): 
if "%NUM%"=="" goto :eof
git tag -l v%NUM% | findstr . >nul && (echo v%NUM% already exists. Pick a higher number. & pause & goto :eof)
git add -A
git commit -m "Tyro-Shelf %NUM%"
git push -u origin main
if errorlevel 1 (echo. & echo Push failed: read the message above. If it says the remote has changes, send it to Claude. & pause & goto :eof)
git tag v%NUM%
git push origin v%NUM%
echo.
echo Done. GitHub is building v%NUM% now: watch the Actions tab, then edit the release notes (bulleted list).
pause

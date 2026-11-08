@echo off
setlocal
cd /d "%~dp0"
echo Tyro-Shelf: publish a new release
echo.
for /f "delims=" %%t in ('git tag --sort=-v:refname') do (set LAST=%%t& goto :got)
:got
echo Last release tag: %LAST%
set /p NUM=New release number (just the number, higher than the last, e.g. 19): 
if "%NUM%"=="" goto :eof
git tag -l v%NUM% | findstr . >nul && (echo v%NUM% already exists. Pick a higher number. & pause & goto :eof)
git add -A
git commit -m "Tyro-Shelf %NUM%" 
git push origin HEAD
if errorlevel 1 (echo Push failed. & pause & goto :eof)
git tag v%NUM%
git push origin v%NUM%
echo.
echo Done. GitHub is building v%NUM% now: watch the Actions tab, then edit the release notes (bulleted list).
pause

param([string]$TvIp="192.168.29.122",[switch]$Install,[string]$OutputDir="$env:USERPROFILE\Downloads\GogoTV-Companion-v02")
$ErrorActionPreference="Stop"
$ProgressPreference="SilentlyContinue"
$base="https://raw.githubusercontent.com/askgogo84/gogo-memory-os/feature/gogo-tvos-v215-hub-20261112/experimental/gogo-tvos-v215"
$src=Join-Path $OutputDir "src\in\askgogo\tvhub"
$res=Join-Path $OutputDir "res\values"
$gen=Join-Path $OutputDir "gen"
$classes=Join-Path $OutputDir "classes"
$dex=Join-Path $OutputDir "dex"
$build=Join-Path $OutputDir "build"
# Clear only compiler intermediates inside the selected build folder.
$rootPath=[System.IO.Path]::GetFullPath($OutputDir)
if($rootPath.Length -lt 14 -or $rootPath -eq [System.IO.Path]::GetPathRoot($rootPath)){throw "Unsafe OutputDir"}
foreach($folder in @($gen,$classes,$dex,$build)){
  if(Test-Path -LiteralPath $folder){Remove-Item -LiteralPath $folder -Recurse -Force}
}
foreach($folder in @($OutputDir,$src,$res,$gen,$classes,$dex,$build)){New-Item -ItemType Directory -Force -Path $folder|Out-Null}
$manifest=Join-Path $OutputDir "AndroidManifest.xml"
$hubFile=Join-Path $src "GogoHubActivity.java"
$brainFile=Join-Path $src "GogoBrainActivity.java"
$stringsFile=Join-Path $res "strings.xml"
$hubOrigin=Join-Path $OutputDir "GogoHubActivity.upstream.java"
Invoke-WebRequest -UseBasicParsing -Uri "$base/GogoHubActivity.java" -OutFile $hubOrigin
Invoke-WebRequest -UseBasicParsing -Uri "$base/companion/GogoBrainActivity.java" -OutFile $brainFile
Invoke-WebRequest -UseBasicParsing -Uri "$base/companion/AndroidManifest.xml" -OutFile $manifest
Invoke-WebRequest -UseBasicParsing -Uri "$base/companion/res/values/strings.xml" -OutFile $stringsFile
$hub=[System.IO.File]::ReadAllText($hubOrigin)
$brain=[System.IO.File]::ReadAllText($brainFile)
$xml=[System.IO.File]::ReadAllText($manifest)
if(!$hub.StartsWith("package com.techgenius.tvoslauncher;") -or !$brain.StartsWith("package in.askgogo.tvhub;") -or !$brain.Contains("/api/mobile/link/otp/start") -or !$brain.Contains("/api/agent/run") -or !$xml.Contains('package="in.askgogo.tvhub"') -or $xml.Contains('android.intent.category.HOME')){throw "Source safety check failed. No TV changes."}
$hub=$hub.Replace("package com.techgenius.tvoslauncher;","package in.askgogo.tvhub;")
[System.IO.File]::WriteAllText($hubFile,$hub,(New-Object System.Text.UTF8Encoding($false)))
$sdk=if($env:ANDROID_HOME){$env:ANDROID_HOME}else{"$env:LOCALAPPDATA\Android\Sdk"}
$bt=Join-Path $sdk "build-tools\34.0.0"
$jar=Join-Path $sdk "platforms\android-34\android.jar"
foreach($p in @("$bt\aapt2.exe","$bt\d8.bat","$bt\zipalign.exe","$bt\apksigner.bat",$jar)){if(!(Test-Path $p)){throw "SDK component missing: $p"}}
$jdk=Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -ErrorAction SilentlyContinue|Where-Object{$_.Name -like "jdk-17*"}|Select-Object -First 1
if($jdk){$env:JAVA_HOME=$jdk.FullName}
if(!$env:JAVA_HOME -or !(Test-Path "$env:JAVA_HOME\bin\javac.exe")){throw "JDK17 needed. No TV changes."}
$env:Path="$env:JAVA_HOME\bin;$env:Path"
$resZip=Join-Path $build "res.zip"
$unsigned=Join-Path $build "unsigned.apk"
$aligned=Join-Path $build "aligned.apk"
$apk=Join-Path $build "gogo-tv-companion.apk"
$classesJar=Join-Path $build "classes.jar"
& "$bt\aapt2.exe" compile --dir (Join-Path $OutputDir "res") -o $resZip
if($LASTEXITCODE -ne 0){throw "aapt2 compile failed"}
& "$bt\aapt2.exe" link -o $unsigned -I $jar --manifest $manifest --java $gen --min-sdk-version 24 --target-sdk-version 34 --version-code 2 --version-name "0.2.0" $resZip
if($LASTEXITCODE -ne 0){throw "aapt2 link failed"}
$sources=@($hubFile,$brainFile)
$sources+=@(Get-ChildItem -Recurse -Path $gen -Filter "*.java"|Select-Object -ExpandProperty FullName)
& javac -encoding UTF-8 --release 11 -classpath $jar -d $classes @sources
if($LASTEXITCODE -ne 0){throw "Java compilation failed"}
& jar cf $classesJar -C $classes .
if($LASTEXITCODE -ne 0){throw "classes jar failed"}
& "$bt\d8.bat" --release --min-api 24 --lib $jar --output $dex $classesJar
if($LASTEXITCODE -ne 0){throw "D8 failed"}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[System.IO.Compression.ZipFile]::Open([System.IO.Path]::GetFullPath($unsigned),[System.IO.Compression.ZipArchiveMode]::Update)
try {
  $existing=$archive.GetEntry("classes.dex")
  if($existing){$existing.Delete()}
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,(Join-Path $dex "classes.dex"),"classes.dex",[System.IO.Compression.CompressionLevel]::Optimal)|Out-Null
}finally{$archive.Dispose()}
& "$bt\zipalign.exe" -f 4 $unsigned $aligned
if($LASTEXITCODE -ne 0){throw "zipalign failed"}
$keyDir="$env:USERPROFILE\.gogo-tv\signing"
New-Item -ItemType Directory -Force -Path $keyDir|Out-Null
$key=Join-Path $keyDir "companion-dev.keystore"
if(!(Test-Path $key)){
  & keytool -genkeypair -keystore $key -storepass android -keypass android -alias gogo-dev -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Gogo TV Personal Dev"
  if($LASTEXITCODE -ne 0){throw "Local signing failed"}
}
& "$bt\apksigner.bat" sign --ks $key --ks-key-alias gogo-dev --ks-pass pass:android --key-pass pass:android --out $apk $aligned
if($LASTEXITCODE -ne 0){throw "apksigner failed"}
& "$bt\apksigner.bat" verify $apk
if($LASTEXITCODE -ne 0){throw "APK signature verification failed"}
Write-Host "GOGO TV COMPANION V0.2 BUILD SUCCESSFUL" -ForegroundColor Green
Write-Host "APK: $apk"
Write-Host "Keep local keystore private and safe: $key"
if(!$Install){Write-Host "Build-only: TV unchanged";exit 0}
$adb="$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if(!(Test-Path $adb)){throw "ADB unavailable; build only"}
$serial=$TvIp+":5555"
& $adb connect $serial|Out-Host
$list=@(& $adb devices -l)
$authorized=$list|Where-Object{$_ -match ("^"+[regex]::Escape($serial)+"\s+device(\s|$)")}
if(!$authorized){throw "ADB unauthorized/offline. Installation skipped; allow debugging on TCL."}
$model=((& $adb -s $serial shell getprop ro.product.model)|Out-String).Trim()
if($model -ne "BeyondTV2"){throw "Wrong TV model ($model); no install"}
$out=@(& $adb -s $serial install -r $apk 2>&1)
$out|Out-Host
if($LASTEXITCODE -ne 0 -or $out -notcontains "Success"){throw "Companion install failed; do not uninstall current launcher"}
Write-Host "GOGO TV COMPANION V0.2 INSTALLED; tvOS HOME UNCHANGED" -ForegroundColor Green
Write-Host "Open tvOS Launcher -> Other Apps -> Gogo TV; optionally pin to dock."

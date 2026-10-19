; Inno Setup script for Android DEX (per-user install, no admin by default).
#define AppName "Android DEX"
#define AppVersion "2.0.0"
#define AppPublisher "Android DEX contributors"
#define AppURL "https://github.com/Shrey113/Android-Dex"
#define AppExe "android-dex.cmd"

[Setup]
AppId={{7C57A3B0-4C1E-4B7B-9B6E-2C4A6B7E0D11}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
DefaultDirName={localappdata}\Android DEX
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\..\dist\windows
OutputBaseFilename=Android-DEX-{#AppVersion}-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\icon.ico
UninstallDisplayIcon={app}\icon.ico
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\..\server\*"; DestDir: "{app}\server"; Flags: recursesubdirs createallsubdirs; Excludes: "test,node_modules"
Source: "..\..\app\*"; DestDir: "{app}\app"; Flags: recursesubdirs createallsubdirs
Source: "..\..\sdk\*"; DestDir: "{app}\sdk"; Flags: recursesubdirs createallsubdirs
Source: "..\..\doc\*"; DestDir: "{app}\doc"; Flags: recursesubdirs createallsubdirs
Source: "..\..\README.md"; DestDir: "{app}"
Source: "..\..\LICENSE"; DestDir: "{app}"
Source: "..\..\NOTICE"; DestDir: "{app}"
Source: "..\icon.ico"; DestDir: "{app}"
Source: "android-dex.cmd"; DestDir: "{app}"

[Icons]
Name: "{autoprograms}\Android DEX"; Filename: "{app}\android-dex.cmd"; IconFilename: "{app}\icon.ico"
Name: "{autodesktop}\Android DEX"; Filename: "{app}\android-dex.cmd"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"
Name: "startup"; Description: "Start the bridge at login"; GroupDescription: "Startup:"

[Run]
Filename: "{app}\android-dex.cmd"; Description: "Launch Android DEX"; Flags: nowait postinstall skipifsilent

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "AndroidDEX"; ValueData: """{app}\android-dex.cmd"" --background"; Flags: uninsdeletevalue; Tasks: startup

[Code]
function InitializeSetup(): Boolean;
var NodeVersion: String;
begin
  Result := True;
  if not RegQueryStringValue(HKLM, 'SOFTWARE\Node.js', 'InstallPath', NodeVersion) and
     not RegQueryStringValue(HKCU, 'SOFTWARE\Node.js', 'InstallPath', NodeVersion) then
  begin
    if MsgBox('Node.js 20+ was not detected. Android DEX needs Node to run the bridge.' + #13#10 +
              'Open the download page now?', mbConfirmation, MB_YESNO) = IDYES then
      ShellExec('open', 'https://nodejs.org/en/download', '', '', SW_SHOWNORMAL, ewNoWait, Result)
    else
      Result := False;
  end;
end;

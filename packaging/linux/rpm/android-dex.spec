Name:           android-dex
Version:        2.0.0
Release:        1%{?dist}
Summary:        Android DEX bridge and desktop console
License:        Proprietary
URL:            https://github.com/Shrey113/Android-Dex
Source0:        %{name}-%{version}.tar.gz
BuildArch:      noarch
Requires:       nodejs >= 20.11
Recommends:     android-tools

%description
Mirror Android apps into floating desktop windows, sync clipboard text and
images, transfer files over WebDAV, answer calls and SMS/RCS messages, mirror
notifications and manage game profiles. Zero-dependency Node bridge plus an
offline-first web console.

%prep
%setup -q

%build
# Static assets and server code are shipped as-is; no build step.

%install
mkdir -p %{buildroot}/opt/android-dex %{buildroot}%{_bindir} \
         %{buildroot}%{_datadir}/applications %{buildroot}%{_datadir}/icons/hicolor/1024x1024/apps \
         %{buildroot}%{_userunitdir}
cp -r server app sdk scripts bench doc README.md LICENSE NOTICE CHANGELOG.md %{buildroot}/opt/android-dex/
rm -rf %{buildroot}/opt/android-dex/server/test
ln -s /opt/android-dex/server/src/cli.js %{buildroot}%{_bindir}/android-dex
sed 's|Exec=android-dex|Exec=%{_bindir}/android-dex|g' packaging/linux/android-dex.desktop > %{buildroot}%{_datadir}/applications/android-dex.desktop
cp packaging/icon.png %{buildroot}%{_datadir}/icons/hicolor/1024x1024/apps/android-dex.png
cp packaging/linux/android-dex.service %{buildroot}%{_userunitdir}/android-dex.service

%post
systemctl --user daemon-reload >/dev/null 2>&1 || true

%preun
systemctl --user stop android-dex.service >/dev/null 2>&1 || true
systemctl --user disable android-dex.service >/dev/null 2>&1 || true

%files
/opt/android-dex
%{_bindir}/android-dex
%{_datadir}/applications/android-dex.desktop
%{_datadir}/icons/hicolor/1024x1024/apps/android-dex.png
%{_userunitdir}/android-dex.service

%changelog
* Sun Oct 19 2026 Android DEX contributors <maintainers@android-dex.dev> - 2.0.0-1
- First packaged console release: clipboard, files, telephony, notifications,
  windows/widgets, media IO, game profiles, plugins, diagnostics.

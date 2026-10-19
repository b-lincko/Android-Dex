# @android-dex/sdk

Dependency-free JavaScript client for the Android DEX bridge. Node 18+ and
modern browsers.

```js
import { DexClient } from '@android-dex/sdk';

const dex = new DexClient({ url: 'http://127.0.0.1:8787', token: process.env.DEX_TOKEN });
await dex.connect();

dex.on('notification.received', (n) => console.log(n.title, n.body));
await dex.launch('messages');
await dex.snap('win_messages', 'left-half');
await dex.sendSms('+4915123456789', 'on my way');
```

Full API and headless/kiosk examples: [doc/EMBED_SDK.md](../doc/EMBED_SDK.md).
Verification of a release: [doc/TRUST.md](../doc/TRUST.md).

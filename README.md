# Ubuntu VM Keepalive Server

يحافظ هذا النظام على بيئة Replit + Ubuntu VM حية دائماً عن طريق:

1. **HTTP Ping** كل 25 ثانية لمنع نوم بيئة Replit
2. **نفق SSH عبر WebSocket** للبقاء متصلاً بـ Ubuntu VM

## المكونات

```
Render Server (index.js)
    │
    ├── HTTP GET /health (كل 25s) ──────→ بيئة Replit (يمنع النوم)
    │
    └── WebSocket wss://.../ssh-proxy ──→ Proxy (replit-side/proxy.js)
                                                  │
                                                  └── TCP 127.0.0.1:2222
                                                             │
                                                             └── Ubuntu VM (QEMU)
```

---

## خطوات الإعداد

### الخطوة 1: تشغيل proxy.js على بيئة Replit

في بيئة Replit الخاصة بك (حيث يشتغل QEMU):

```bash
# افتح Shell وشغّل:
cd ~
git clone https://github.com/hakercryptoplus-svg/ubuntu-vm-keepalive.git
cd ubuntu-vm-keepalive/replit-side
npm install
node proxy.js
```

أو اعمل Workflow جديد في Replit:
- **Command**: `cd ~/ubuntu-vm-keepalive/replit-side && node proxy.js`
- **Port**: 3000

### الخطوة 2: نشر Render Server

1. افتح [render.com](https://render.com) وأنشئ حساباً مجانياً
2. انقر **New → Web Service**
3. اربط الريبو: `hakercryptoplus-svg/ubuntu-vm-keepalive`
4. سيقرأ `render.yaml` تلقائياً كل الإعدادات
5. انقر **Deploy**

### الخطوة 3: تحقق

بعد النشر، افتح رابط Render وستجد Dashboard يُظهر:
- ✓ SSH متصل
- عدد الـ Ping الناجحة
- آخر مخرجات Shell من Ubuntu VM

---

## متغيرات البيئة في Render

| المتغير | القيمة | الوصف |
|---------|--------|-------|
| `REPLIT_HOST` | `4a52e65a88c1-00-19z61njhlnfbf.janeway.replit.dev` | hostname بيئة Replit |
| `SSH_USER` | `ubuntu` | اسم مستخدم Ubuntu VM |
| `SSH_PASSWORD` | `ubuntu123` | كلمة مرور Ubuntu VM |
| `PING_INTERVAL` | `25000` | ms بين كل ping |
| `SSH_RECONNECT` | `8000` | ms قبل إعادة اتصال SSH |

---

## ملفات الريبو

| الملف | الوصف |
|-------|-------|
| `index.js` | سيرفر Render — يحافظ على الاتصال |
| `package.json` | Dependencies لـ Render |
| `render.yaml` | إعدادات Render تلقائية |
| `replit-side/proxy.js` | Proxy يشتغل على بيئة Replit — يوصل WebSocket بـ Ubuntu VM |
| `replit-side/package.json` | Dependencies للـ proxy |

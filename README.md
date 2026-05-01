# Ubuntu VM Keepalive Server

يحافظ هذا السيرفر على اتصال دائم ببيئة Replit و Ubuntu VM عن طريق:

1. **HTTP Ping** كل 25 ثانية لمنع النوم
2. **نفق SSH عبر WebSocket** للاتصال بـ Ubuntu VM

## المتطلبات

- الريبو متصل بـ [Render](https://render.com)
- بيئة Replit تشتغل مع `api-server`

## النشر على Render

1. افتح [render.com](https://render.com) وأنشئ حساباً
2. اختر **New → Web Service**
3. اربط هذا الريبو: `ubuntu-vm-keepalive`
4. استخدم الإعدادات:
   - **Build**: `npm install`
   - **Start**: `node index.js`
5. أضف متغير البيئة:
   - `SSH_PASSWORD` = `ubuntu123`

## متغيرات البيئة

| المتغير | القيمة الافتراضية | الوصف |
|---------|----------|-------|
| `REPLIT_HOST` | (مضبوط) | hostname بيئة Replit |
| `SSH_USER` | `ubuntu` | اسم المستخدم في Ubuntu VM |
| `SSH_PASSWORD` | — | كلمة مرور Ubuntu (اضبطها يدوياً في Render) |
| `PING_INTERVAL` | `25000` | فترة الـ ping بالميلي ثانية |
| `SSH_RECONNECT` | `8000` | فترة إعادة الاتصال |

## Dashboard

بعد النشر، افتح رابط Render لترى لوحة التحكم مع:
- حالة اتصال SSH
- سجل الـ ping
- آخر مخرجات Shell
- إمكانية تنفيذ أوامر على Ubuntu VM

## كيف يعمل

```
Render Server
    │
    ├── HTTP GET /api/health (كل 25s) ──→ Replit API Server (يمنع النوم)
    │
    └── WebSocket wss://.../api/ssh-proxy ──→ Replit API Server
                                                      │
                                                      └── TCP localhost:2222
                                                                 │
                                                                 └── Ubuntu VM (QEMU)
```

# Sivra — Backend Server

Your self-hosted commerce platform backend. Handles all data: products, orders, customers, auth.

---

## Quick Start (your machine)

### 1. Install Node.js
Download from https://nodejs.org — get the LTS version (22+)

### 2. Set up the project

```bash
# Put this folder somewhere on your computer, then:
cd sivra
npm install
```

### 3. Create your .env file

```bash
cp .env.example .env
```

Open `.env` and change `JWT_SECRET` to a long random string (like 40+ random characters).

### 4. Start the server

```bash
# Development (auto-restarts when you save files)
npm run dev

# Production
npm start
```

You'll see:
```
╔══════════════════════════════════════╗
║         SIVRA SERVER RUNNING         ║
║  Local:   http://localhost:3000      ║
╚══════════════════════════════════════╝
```

The database file (`sivra.db`) is created automatically on first run. No setup needed.

---

## Put your HTML files in

Create a `public/` folder inside the `sivra/` folder and copy your HTML files there:

```
sivra/
├── public/
│   ├── sivra-login.html
│   ├── sivra-dashboard.html
│   ├── sivra-products.html
│   ├── sivra-orders.html
│   ├── sivra-customers.html
│   └── sivra-storefront.html
├── server.js
├── routes/
├── db/
└── ...
```

Then visit `http://localhost:3000/sivra-login.html`

---

## API Reference

All merchant routes require: `Authorization: Bearer <token>`

### Auth
| Method | Endpoint | What it does |
|--------|----------|--------------|
| POST | `/api/auth/signup` | Create account + store |
| POST | `/api/auth/login` | Get token |
| GET | `/api/auth/me` | Get current merchant |
| POST | `/api/auth/change-password` | Change password |

### Products
| Method | Endpoint | What it does |
|--------|----------|--------------|
| GET | `/api/products` | List all products |
| GET | `/api/products/:id` | Get one product |
| POST | `/api/products` | Create product |
| PATCH | `/api/products/:id` | Update product |
| DELETE | `/api/products/:id` | Delete product |
| PATCH | `/api/products/bulk/status` | Bulk update status |

### Orders
| Method | Endpoint | What it does |
|--------|----------|--------------|
| GET | `/api/orders` | List all orders |
| GET | `/api/orders/:id` | Get one order + items |
| POST | `/api/orders` | Create manual order |
| PATCH | `/api/orders/:id` | Update status |
| POST | `/api/orders/:id/cancel` | Cancel + restore stock |

### Customers
| Method | Endpoint | What it does |
|--------|----------|--------------|
| GET | `/api/customers` | List customers |
| GET | `/api/customers/:id` | Get customer + orders |
| POST | `/api/customers` | Add customer |
| PATCH | `/api/customers/:id` | Update customer |
| DELETE | `/api/customers/:id` | Delete customer |

### Store
| Method | Endpoint | What it does |
|--------|----------|--------------|
| GET | `/api/store/dashboard` | All dashboard stats |
| GET | `/api/store/settings` | Store info |
| PATCH | `/api/store/settings` | Update store info |

### Public Storefront (no auth)
| Method | Endpoint | What it does |
|--------|----------|--------------|
| GET | `/api/storefront/:slug` | Store info |
| GET | `/api/storefront/:slug/products` | Public product list |
| GET | `/api/storefront/:slug/products/:id` | One product |
| POST | `/api/storefront/:slug/checkout` | Place order |

---

## Deploy to Railway (recommended — ~$5/month)

1. Go to https://railway.app and sign up
2. Click **New Project** → **Deploy from GitHub**
3. Push this folder to a GitHub repo first, then connect it
4. Railway auto-detects Node.js and runs `npm start`
5. Add your environment variables in Railway's dashboard
6. Get a live URL like `https://sivra-production.up.railway.app`

---

## Files explained

```
server.js          ← Starts the server, connects all routes
.env.example       ← Copy to .env, fill in your secrets
db/
  database.js      ← Creates SQLite database + all tables
routes/
  auth.js          ← Signup, login, change password
  products.js      ← Product CRUD
  orders.js        ← Order management
  customers.js     ← Customer management
  store.js         ← Dashboard stats + store settings
  storefront.js    ← Public shop API (no login needed)
middleware/
  auth.js          ← Checks JWT token on protected routes
```

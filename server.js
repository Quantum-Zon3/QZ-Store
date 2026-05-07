import { createServer } from "node:http";
import { existsSync, createReadStream } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const BANK_BASE_URL = process.env.BANK_BASE_URL || "http://localhost:8083";
const BANK_BALANCE_PATH = process.env.BANK_BALANCE_PATH || "/api/balance";
const BANK_DEBIT_PATH = process.env.BANK_DEBIT_PATH || "/api/balance/debit";

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "qz_store",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const seedProducts = [
  {
    name: "Orejas de pollo",
    category: "Alimentacion",
    price: 20,
    description: "El producto estrella. Cada 10 USD aqui suman 1 Tamalbit.",
  },
  {
    name: "Combo tamal",
    category: "Alimentacion",
    price: 12,
    description: "Desayuno rapido para arrancar el dia con energia.",
  },
  {
    name: "Pasaje urbano",
    category: "Transporte",
    price: 3.5,
    description: "Gasto comun de movilidad dentro de la ciudad.",
  },
  {
    name: "Recarga de energia",
    category: "Servicios publicos",
    price: 18,
    description: "Pago simple para simular servicios del hogar.",
  },
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL UNIQUE,
      category VARCHAR(80) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      description TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_name VARCHAR(120) NOT NULL,
      product_id INT NULL,
      product_name VARCHAR(120) NULL,
      amount DECIMAL(10,2) NOT NULL,
      category VARCHAR(80) NOT NULL,
      description TEXT NULL,
      tamalbits_earned INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_expenses_product
        FOREIGN KEY (product_id) REFERENCES products(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
    )
  `);

  for (const product of seedProducts) {
    await pool.query(
      `
        INSERT INTO products (name, category, price, description)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          category = VALUES(category),
          price = VALUES(price),
          description = VALUES(description)
      `,
      [product.name, product.category, product.price, product.description]
    );
  }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("El cuerpo de la solicitud no tiene JSON valido."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

async function requestBank(path, options = {}) {
  const response = await fetch(`${BANK_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const rawText = await response.text();
  let data = null;

  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = rawText;
  }

  if (!response.ok) {
    throw new Error(
      typeof data === "string" && data
        ? data
        : "La API del banco rechazo la operacion."
    );
  }

  return data;
}

function normalizeBalance(data) {
  if (typeof data === "number") {
    return data;
  }

  if (typeof data === "string") {
    const parsed = Number(data);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  if (!data || typeof data !== "object") {
    throw new Error("La respuesta de saldo de la API no es valida.");
  }

  const candidates = [
    data.balance,
    data.saldo,
    data.currentBalance,
    data.availableBalance,
    data?.data?.balance,
    data?.data?.saldo,
  ];

  for (const value of candidates) {
    if (typeof value === "number") {
      return value;
    }
  }

  throw new Error("No fue posible encontrar el saldo en la respuesta de la API.");
}

async function getBankBalance() {
  try {
    const data = await requestBank(BANK_BALANCE_PATH);
    return {
      balance: normalizeBalance(data),
      message: `Conectado con ${BANK_BASE_URL}`,
    };
  } catch (error) {
    throw new Error(
      `No se pudo consultar la API bank en ${BANK_BASE_URL}. Revisa que el jar este corriendo y ajusta las rutas en server.js o variables de entorno. Detalle: ${error.message}`
    );
  }
}

async function debitBankBalance(amount) {
  const payload = JSON.stringify({ amount, monto: amount });

  try {
    await requestBank(BANK_DEBIT_PATH, {
      method: "POST",
      body: payload,
    });
  } catch (error) {
    throw new Error(`No se pudo descontar saldo en la API bank. ${error.message}`);
  }
}

async function getProducts() {
  const [rows] = await pool.query(`
    SELECT id, name, category, price, description
    FROM products
    ORDER BY price ASC, name ASC
  `);

  return rows.map((row) => ({
    ...row,
    price: Number(row.price),
  }));
}

async function getExpenses() {
  const [rows] = await pool.query(`
    SELECT
      id,
      user_name AS userName,
      product_name AS productName,
      amount,
      category,
      description,
      tamalbits_earned AS tamalbitsEarned,
      created_at AS createdAt
    FROM expenses
    ORDER BY created_at DESC, id DESC
    LIMIT 12
  `);

  return rows.map((row) => ({
    ...row,
    amount: Number(row.amount),
  }));
}

async function getSummary() {
  const [rows] = await pool.query(`
    SELECT
      COALESCE(SUM(amount), 0) AS totalSpent,
      COALESCE(SUM(tamalbits_earned), 0) AS totalTamalbits
    FROM expenses
  `);

  return {
    totalSpent: Number(rows[0].totalSpent),
    totalTamalbits: Number(rows[0].totalTamalbits),
  };
}

function calculateTamalbits(productName, amount) {
  const normalizedName = (productName || "").trim().toLowerCase();
  if (normalizedName !== "orejas de pollo") {
    return 0;
  }

  return Math.floor(amount / 10);
}

async function buildDashboard() {
  const [summary, products, expenses] = await Promise.all([
    getSummary(),
    getProducts(),
    getExpenses(),
  ]);

  try {
    const bank = await getBankBalance();
    return {
      balance: bank.balance,
      bank: {
        ...bank,
        available: true,
      },
      summary,
      consistency: null,
      products,
      expenses,
    };
  } catch (error) {
    return {
      balance: null,
      bank: {
        available: false,
        message: error.message,
      },
      summary,
      consistency: null,
      products,
      expenses,
    };
  }
}

async function findProductById(productId) {
  const [rows] = await pool.query(`
    SELECT id, name, category, price, description
    FROM products
    WHERE id = ?
    LIMIT 1
  `, [productId]);

  if (!rows[0]) {
    return null;
  }

  return {
    ...rows[0],
    price: Number(rows[0].price),
  };
}

async function handleCreateExpense(request, response) {
  const payload = await readRequestBody(request);
  const userName = String(payload.userName || "").trim();

  if (!userName) {
    sendJson(response, 400, { error: "El nombre del usuario es obligatorio." });
    return;
  }

  let amount = Number(payload.amount);
  let category = String(payload.category || "Otros").trim() || "Otros";
  let description = String(payload.description || "").trim();
  let productId = payload.productId ? Number(payload.productId) : null;
  let productName = null;

  if (productId) {
    const product = await findProductById(productId);

    if (!product) {
      sendJson(response, 404, { error: "El producto seleccionado no existe." });
      return;
    }

    amount = Number(product.price);
    category = product.category;
    productName = product.name;
    if (!description) {
      description = `Compra de ${product.name}`;
    }
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    sendJson(response, 400, { error: "El monto debe ser mayor a cero." });
    return;
  }

  const bank = await getBankBalance().catch((error) => {
    sendJson(response, 503, { error: error.message });
    return null;
  });

  if (!bank) {
    return;
  }

  if (amount > bank.balance) {
    sendJson(response, 400, { error: "No puedes registrar un gasto mayor al saldo disponible." });
    return;
  }

  await debitBankBalance(amount).catch((error) => {
    sendJson(response, 502, { error: error.message });
    return null;
  });

  const tamalbitsEarned = calculateTamalbits(productName || description, amount);

  await pool.query(`
    INSERT INTO expenses (
      user_name,
      product_id,
      product_name,
      amount,
      category,
      description,
      tamalbits_earned
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    userName,
    productId,
    productName,
    amount,
    category,
    description,
    tamalbitsEarned,
  ]);

  const dashboard = await buildDashboard();

  sendJson(response, 201, {
    message: tamalbitsEarned > 0
      ? `Gasto registrado. Ganaste ${tamalbitsEarned} Tamalbits.`
      : "Gasto registrado correctamente.",
    dashboard,
  });
}

function serveStaticFile(request, response) {
  const requestPath = request.url === "/" ? "/index.html" : request.url;
  const safePath = requestPath.split("?")[0];
  const filePath = join(__dirname, safePath);
  const extension = extname(filePath);

  if (!mimeTypes[extension] || !existsSync(filePath)) {
    sendJson(response, 404, { error: "Recurso no encontrado." });
    return;
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes[extension],
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url?.startsWith("/api/dashboard")) {
      const dashboard = await buildDashboard();
      sendJson(response, 200, dashboard);
      return;
    }

    if (request.method === "POST" && request.url === "/api/expenses") {
      await handleCreateExpense(request, response);
      return;
    }

    if (request.method === "GET") {
      serveStaticFile(request, response);
      return;
    }

    sendJson(response, 405, { error: "Metodo no permitido." });
  } catch (error) {
    sendJson(response, 500, {
      error: error.message || "Error interno del servidor.",
    });
  }
});

initializeDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`QZ Store disponible en http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("No se pudo iniciar la aplicacion:", error.message);
    process.exit(1);
  });

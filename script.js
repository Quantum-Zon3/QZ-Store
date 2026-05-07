const balanceValue = document.getElementById("balanceValue");
const spentValue = document.getElementById("spentValue");
const tamalbitValue = document.getElementById("tamalbitValue");
const productList = document.getElementById("productList");
const expenseTableBody = document.getElementById("expenseTableBody");
const consistencyBadge = document.getElementById("consistencyBadge");
const apiMessage = document.getElementById("apiMessage");
const toast = document.getElementById("toast");
const refreshButton = document.getElementById("refreshButton");
const expenseForm = document.getElementById("expenseForm");
const productCardTemplate = document.getElementById("productCardTemplate");

let dashboardState = null;

const currency = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "USD",
});

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.className = `toast ${isError ? "toast-error" : "toast-success"}`;

  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    toast.className = "toast hidden";
  }, 3000);
}

function setConsistencyStatus(consistency) {
  if (!consistency) {
    consistencyBadge.textContent = "Sin datos";
    consistencyBadge.className = "badge badge-waiting";
    return;
  }

  if (consistency.ok) {
    consistencyBadge.textContent = "Saldo consistente";
    consistencyBadge.className = "badge badge-ok";
    return;
  }

  consistencyBadge.textContent = "Revisar diferencias";
  consistencyBadge.className = "badge badge-error";
}

function renderProducts(products = [], bankAvailable = false) {
  productList.innerHTML = "";

  for (const product of products) {
    const card = productCardTemplate.content.cloneNode(true);
    const button = card.querySelector(".buy-button");
    card.querySelector(".product-category").textContent = product.category;
    card.querySelector(".product-name").textContent = product.name;
    card.querySelector(".product-description").textContent = product.description;
    card.querySelector(".product-price").textContent = currency.format(product.price);
    button.disabled = !bankAvailable;
    button.textContent = bankAvailable ? "Comprar" : "Bank no disponible";
    button.addEventListener("click", () => buyProduct(product.id));
    productList.appendChild(card);
  }
}

function renderExpenses(expenses = []) {
  expenseTableBody.innerHTML = "";

  if (!expenses.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="6" class="empty-state">Aun no hay gastos registrados.</td>';
    expenseTableBody.appendChild(row);
    return;
  }

  for (const expense of expenses) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${new Date(expense.createdAt).toLocaleString("es-CO")}</td>
      <td>${expense.userName}</td>
      <td>${expense.category}</td>
      <td>${expense.description || "-"}</td>
      <td>${currency.format(expense.amount)}</td>
      <td>${expense.tamalbitsEarned}</td>
    `;
    expenseTableBody.appendChild(row);
  }
}

function renderDashboard(data) {
  dashboardState = data;
  balanceValue.textContent = typeof data.balance === "number"
    ? currency.format(data.balance)
    : "No disponible";
  spentValue.textContent = currency.format(data.summary.totalSpent);
  tamalbitValue.textContent = data.summary.totalTamalbits;
  apiMessage.textContent = data.bank.message;
  setConsistencyStatus(data.consistency);
  renderProducts(data.products, data.bank.available);
  renderExpenses(data.expenses);
}

async function loadDashboard() {
  try {
    const response = await fetch("/api/dashboard");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "No se pudo cargar el panel.");
    }

    renderDashboard(data);
  } catch (error) {
    apiMessage.textContent = error.message;
    showToast(error.message, true);
  }
}

async function sendExpense(payload) {
  const response = await fetch("/api/expenses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "No fue posible registrar el gasto.");
  }

  renderDashboard(data.dashboard);
  showToast(data.message || "Gasto registrado con exito.");
}

async function buyProduct(productId) {
  const userName = document.getElementById("userName").value.trim();

  if (!userName) {
    showToast("Escribe el nombre del usuario antes de comprar.", true);
    document.getElementById("userName").focus();
    return;
  }

  const product = dashboardState?.products.find((item) => item.id === productId);
  if (!product) {
    showToast("Producto no encontrado.", true);
    return;
  }

  await sendExpense({
    userName,
    productId,
    description: `Compra de ${product.name}`,
  }).catch((error) => showToast(error.message, true));
}

expenseForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(expenseForm);

  try {
    await sendExpense({
      userName: formData.get("userName").trim(),
      amount: Number(formData.get("amount")),
      category: formData.get("category"),
      description: formData.get("description").trim(),
    });
    expenseForm.reset();
  } catch (error) {
    showToast(error.message, true);
  }
});

async function reset() {
  await PoolConnection.query("TRUNCATE TABLE expenses");
  
}

refreshButton.addEventListener("click", loadDashboard);

loadDashboard();

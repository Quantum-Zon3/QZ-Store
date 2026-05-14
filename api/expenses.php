<?php

require_once __DIR__ . '/helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendJson(405, ['error' => 'Metodo no permitido.']);
}

initializeDatabase($pdo);

$payload = readJsonBody();
$userName = trim((string) ($payload['userName'] ?? ''));

if ($userName === '') {
    sendJson(400, ['error' => 'El nombre del usuario es obligatorio.']);
}

$amount = isset($payload['amount']) ? (float) $payload['amount'] : 0;
$category = trim((string) ($payload['category'] ?? 'Otros'));
$category = $category !== '' ? $category : 'Otros';
$description = trim((string) ($payload['description'] ?? ''));
$productId = isset($payload['productId']) ? (int) $payload['productId'] : null;
$productName = null;

if ($productId) {
    $product = findProductById($pdo, $productId);

    if (!$product) {
        sendJson(404, ['error' => 'El producto seleccionado no existe.']);
    }

    $amount = (float) $product['price'];
    $category = $product['category'];
    $productName = $product['name'];

    if ($description === '') {
        $description = 'Compra de ' . $product['name'];
    }
}

if ($amount <= 0) {
    sendJson(400, ['error' => 'El monto debe ser mayor a cero.']);
}

if ($amount > getStoredBalance($pdo)) {
    sendJson(400, ['error' => 'No puedes registrar un gasto mayor al saldo disponible.']);
}

$currentBalance = getStoredBalance($pdo);
updateStoredBalance($pdo, $currentBalance - $amount);

try {
    debitBankBalance($amount, $description);
} catch (Throwable $exception) {
}

$tamalbitsEarned = calculateTamalbits($productName ?: $description, $amount);

$statement = $pdo->prepare(
    'INSERT INTO expenses (
        user_name,
        product_id,
        product_name,
        amount,
        category,
        description,
        tamalbits_earned
    ) VALUES (
        :user_name,
        :product_id,
        :product_name,
        :amount,
        :category,
        :description,
        :tamalbits_earned
    )'
);

$statement->execute([
    'user_name' => $userName,
    'product_id' => $productId,
    'product_name' => $productName,
    'amount' => $amount,
    'category' => $category,
    'description' => $description,
    'tamalbits_earned' => $tamalbitsEarned,
]);

sendJson(201, [
    'message' => $tamalbitsEarned > 0
        ? 'Gasto registrado. Ganaste ' . $tamalbitsEarned . ' Tamalbits.'
        : 'Gasto registrado correctamente.',
    'dashboard' => buildDashboard($pdo),
]);

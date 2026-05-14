<?php

require_once __DIR__ . '/db.php';

function sendJson(int $statusCode, array $payload): void
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function readJsonBody(): array
{
    $rawBody = file_get_contents('php://input');

    if ($rawBody === false || trim($rawBody) === '') {
        return [];
    }

    $decoded = json_decode($rawBody, true);

    if (!is_array($decoded)) {
        sendJson(400, ['error' => 'El cuerpo de la solicitud no tiene JSON valido.']);
    }

    return $decoded;
}

function initializeDatabase(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS products (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(120) NOT NULL UNIQUE,
            category VARCHAR(80) NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            description TEXT NOT NULL
        )'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS expenses (
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
        )'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS app_state (
            id TINYINT PRIMARY KEY,
            current_balance DECIMAL(10,2) NOT NULL
        )'
    );

    $seedProducts = [
        [
            'name' => 'Orejas de pollo',
            'category' => 'Alimentacion',
            'price' => 20,
            'description' => 'El producto estrella. Cada 10 USD aqui suman 1 Tamalbit.',
        ],
        [
            'name' => 'Combo tamal',
            'category' => 'Alimentacion',
            'price' => 12,
            'description' => 'Desayuno rapido para arrancar el dia con energia.',
        ],
        [
            'name' => 'Pasaje urbano',
            'category' => 'Transporte',
            'price' => 3.5,
            'description' => 'Gasto comun de movilidad dentro de la ciudad.',
        ],
        [
            'name' => 'Recarga de energia',
            'category' => 'Servicios publicos',
            'price' => 18,
            'description' => 'Pago simple para simular servicios del hogar.',
        ],
    ];

    $statement = $pdo->prepare(
        'INSERT INTO products (name, category, price, description)
         VALUES (:name, :category, :price, :description)
         ON DUPLICATE KEY UPDATE
            category = VALUES(category),
            price = VALUES(price),
            description = VALUES(description)'
    );

    foreach ($seedProducts as $product) {
        $statement->execute($product);
    }

    $pdo->exec(
        'INSERT INTO app_state (id, current_balance)
         VALUES (1, 10000.00)
         ON DUPLICATE KEY UPDATE current_balance = current_balance'
    );
}

function requestBank(string $path, array $options = []): array|string|int|float|null
{
    global $config;

    $url = $config['bank_base_url'] . $path;
    $curl = curl_init($url);

    $headers = ['Content-Type: application/json'];
    if (!empty($options['headers']) && is_array($options['headers'])) {
        $headers = array_merge($headers, $options['headers']);
    }

    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CUSTOMREQUEST => $options['method'] ?? 'GET',
    ]);

    if (array_key_exists('body', $options)) {
        curl_setopt($curl, CURLOPT_POSTFIELDS, $options['body']);
    }

    $rawResponse = curl_exec($curl);

    if ($rawResponse === false) {
        $error = curl_error($curl);
        curl_close($curl);
        throw new RuntimeException('No fue posible conectar con la API bank. ' . $error);
    }

    $statusCode = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);

    $decoded = json_decode($rawResponse, true);
    $data = json_last_error() === JSON_ERROR_NONE ? $decoded : $rawResponse;

    if ($statusCode < 200 || $statusCode >= 300) {
        if (is_string($data) && $data !== '') {
            throw new RuntimeException($data);
        }

        throw new RuntimeException('La API del banco rechazo la operacion.');
    }

    return $data;
}

function normalizeBalance(mixed $data): float
{
    if (is_numeric($data)) {
        return (float) $data;
    }

    if (!is_array($data)) {
        throw new RuntimeException('La respuesta de saldo de la API no es valida.');
    }

    $candidates = [
        $data['balance'] ?? null,
        $data['saldo'] ?? null,
        $data['currentBalance'] ?? null,
        $data['availableBalance'] ?? null,
        $data['data']['balance'] ?? null,
        $data['data']['saldo'] ?? null,
    ];

    foreach ($candidates as $value) {
        if (is_numeric($value)) {
            return (float) $value;
        }
    }

    throw new RuntimeException('No fue posible encontrar el saldo en la respuesta de la API.');
}

function getBankBalance(): array
{
    global $config;

    try {
        $data = requestBank($config['bank_balance_path']);

        return [
            'balance' => normalizeBalance($data),
            'message' => 'Conectado con ' . $config['bank_base_url'],
        ];
    } catch (Throwable $exception) {
        throw new RuntimeException(
            'No se pudo consultar la API bank en ' . $config['bank_base_url'] .
            '. Revisa que el jar este corriendo. Detalle: ' . $exception->getMessage()
        );
    }
}

function debitBankBalance(float $amount, string $reason): void
{
    global $config;

    $payload = json_encode([
        'amount' => $amount,
        'reason' => $reason,
    ], JSON_UNESCAPED_UNICODE);

    try {
        requestBank($config['bank_debit_path'], [
            'method' => 'POST',
            'body' => $payload,
        ]);
    } catch (Throwable $exception) {
        throw new RuntimeException('No se pudo descontar saldo en la API bank. ' . $exception->getMessage());
    }
}

function getStoredBalance(PDO $pdo): float
{
    $statement = $pdo->query(
        'SELECT current_balance
         FROM app_state
         WHERE id = 1
         LIMIT 1'
    );

    $state = $statement->fetch();

    if (!$state) {
        $pdo->exec('INSERT INTO app_state (id, current_balance) VALUES (1, 10000.00)');
        return 10000.0;
    }

    return (float) $state['current_balance'];
}

function updateStoredBalance(PDO $pdo, float $newBalance): void
{
    $statement = $pdo->prepare(
        'UPDATE app_state
         SET current_balance = :current_balance
         WHERE id = 1'
    );

    $statement->execute([
        'current_balance' => $newBalance,
    ]);
}

function getProducts(PDO $pdo): array
{
    $statement = $pdo->query(
        'SELECT id, name, category, price, description
         FROM products
         ORDER BY price ASC, name ASC'
    );

    $products = $statement->fetchAll();

    return array_map(function (array $product): array {
        $product['id'] = (int) $product['id'];
        $product['price'] = (float) $product['price'];
        return $product;
    }, $products);
}

function getExpenses(PDO $pdo): array
{
    $statement = $pdo->query(
        'SELECT
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
         LIMIT 12'
    );

    $expenses = $statement->fetchAll();

    return array_map(function (array $expense): array {
        $expense['id'] = (int) $expense['id'];
        $expense['amount'] = (float) $expense['amount'];
        $expense['tamalbitsEarned'] = (int) $expense['tamalbitsEarned'];
        return $expense;
    }, $expenses);
}

function getSummary(PDO $pdo): array
{
    $statement = $pdo->query(
        'SELECT
            COALESCE(SUM(amount), 0) AS totalSpent,
            COALESCE(SUM(tamalbits_earned), 0) AS totalTamalbits
         FROM expenses'
    );

    $summary = $statement->fetch();

    return [
        'totalSpent' => (float) $summary['totalSpent'],
        'totalTamalbits' => (int) $summary['totalTamalbits'],
    ];
}

function calculateTamalbits(string $productName, float $amount): int
{
    if (mb_strtolower(trim($productName)) !== 'orejas de pollo') {
        return 0;
    }

    return (int) floor($amount / 10);
}

function findProductById(PDO $pdo, int $productId): ?array
{
    $statement = $pdo->prepare(
        'SELECT id, name, category, price, description
         FROM products
         WHERE id = :id
         LIMIT 1'
    );
    $statement->execute(['id' => $productId]);
    $product = $statement->fetch();

    if (!$product) {
        return null;
    }

    $product['id'] = (int) $product['id'];
    $product['price'] = (float) $product['price'];
    return $product;
}

function resetExpenses(PDO $pdo): array
{
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
    $pdo->exec('TRUNCATE TABLE expenses');
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
    updateStoredBalance($pdo, 10000.0);

    return [
        'success' => true,
        'message' => 'Gastos reiniciados y saldo restaurado a 10000.',
    ];
}

function buildDashboard(PDO $pdo): array
{
    $summary = getSummary($pdo);
    $products = getProducts($pdo);
    $expenses = getExpenses($pdo);
    $storedBalance = getStoredBalance($pdo);

    try {
        getBankBalance();

        return [
            'balance' => $storedBalance,
            'bank' => [
                'available' => true,
                'message' => 'Saldo persistente gestionado en MySQL. Servicio bank disponible para integracion.',
            ],
            'summary' => $summary,
            'consistency' => null,
            'products' => $products,
            'expenses' => $expenses,
        ];
    } catch (Throwable $exception) {
        return [
            'balance' => $storedBalance,
            'bank' => [
                'available' => true,
                'message' => 'Saldo persistente gestionado en MySQL. El servicio bank no esta disponible: ' . $exception->getMessage(),
            ],
            'summary' => $summary,
            'consistency' => null,
            'products' => $products,
            'expenses' => $expenses,
        ];
    }
}

<?php

function loadEnvFile(string $path): array
{
    $values = [];

    if (!file_exists($path)) {
        return $values;
    }

    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);

    foreach ($lines as $line) {
        $trimmedLine = trim($line);

        if ($trimmedLine === '' || str_starts_with($trimmedLine, '#')) {
            continue;
        }

        $separatorPosition = strpos($trimmedLine, '=');
        if ($separatorPosition === false) {
            continue;
        }

        $key = trim(substr($trimmedLine, 0, $separatorPosition));
        $value = trim(substr($trimmedLine, $separatorPosition + 1));

        $values[$key] = $value;
    }

    return $values;
}

$env = loadEnvFile(__DIR__ . '/../.env');

return [
    'db_host' => $env['DB_HOST'] ?? '127.0.0.1',
    'db_port' => $env['DB_PORT'] ?? '3306',
    'db_user' => $env['DB_USER'] ?? 'root',
    'db_password' => $env['DB_PASSWORD'] ?? '',
    'db_name' => $env['DB_NAME'] ?? 'tienditaqz',
    'bank_base_url' => $env['BANK_BASE_URL'] ?? 'http://localhost:8083',
    'bank_balance_path' => $env['BANK_BALANCE_PATH'] ?? '/api/account/240420241050',
    'bank_debit_path' => $env['BANK_DEBIT_PATH'] ?? '/api/account/240420241050/deduct',
];

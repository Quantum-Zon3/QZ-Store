<?php

require_once __DIR__ . '/helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendJson(405, ['error' => 'Metodo no permitido.']);
}

initializeDatabase($pdo);
sendJson(200, resetExpenses($pdo));

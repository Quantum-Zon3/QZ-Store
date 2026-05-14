<?php
$host = "127.0.0.1";
$puerto = "3306";
$baseDeDatos = "tienditaqz";
$usuario = "root";
$contrasena = "";

try {
    $conexion = new PDO(
        "mysql:host=$host;port=$puerto;dbname=$baseDeDatos;charset=utf8mb4",
        $usuario,
        $contrasena
    );
    $conexion->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $conexion->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
} catch (PDOException $e) {
    die("Error de conexion: " . $e->getMessage());
}
?>

<?php
// Fachada Apache/XAMPP. A interface é servida na porta 80 e as chamadas da
// aplicação são encaminhadas internamente ao servidor Node na porta 3000.
$requestPath = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$basePath = '/gestao-ferias-abonos';
$apiPosition = strpos($requestPath, $basePath . '/api/');

if ($apiPosition !== false) {
    $apiPath = substr($requestPath, $apiPosition + strlen($basePath));
    $query = $_SERVER['QUERY_STRING'] ?? '';
    $target = 'http://127.0.0.1:3000' . $apiPath . ($query ? '?' . $query : '');
    $curl = curl_init($target);
    $headers = ['Content-Type: ' . ($_SERVER['CONTENT_TYPE'] ?? 'application/json')];
    if (!empty($_SERVER['HTTP_COOKIE'])) $headers[] = 'Cookie: ' . $_SERVER['HTTP_COOKIE'];
    curl_setopt_array($curl, [
        CURLOPT_CUSTOMREQUEST => $_SERVER['REQUEST_METHOD'],
        CURLOPT_POSTFIELDS => file_get_contents('php://input'),
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADERFUNCTION => function ($curl, $header) {
            $length = strlen($header);
            $name = strtolower(trim(strtok($header, ':')));
            if (in_array($name, ['set-cookie', 'content-type'])) header(trim($header), false);
            return $length;
        },
        CURLOPT_TIMEOUT => 15,
    ]);
    $response = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_HTTP_CODE);
    if ($response === false) {
        http_response_code(503);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'O serviço está desligado. Execute iniciar.bat e tente novamente.']);
    } else {
        http_response_code($status ?: 502);
        echo $response;
    }
    curl_close($curl);
    exit;
}

readfile(__DIR__ . '/public/index.html');

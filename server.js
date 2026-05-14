import { createServer } from "node:http";
import { existsSync, createReadStream } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".php": "text/plain; charset=utf-8",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
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
    if (request.url?.startsWith("/api/")) {
      sendJson(response, 501, {
        error: "Las rutas API ahora viven en PHP bajo XAMPP. Usa Apache y abre el proyecto desde htdocs.",
      });
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

server.listen(PORT, () => {
  console.log(`QZ Store estatico disponible en http://localhost:${PORT}`);
  console.log("La capa de base de datos y las consultas API ahora se ejecutan en PHP con XAMPP.");
});

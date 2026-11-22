import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(projectRoot, "reference", "frozen", "home");
const manifestPath = path.join(fixtureRoot, "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const gallery = manifest.gallery?.mapping || {};
const portArgument = Number(process.env.REFERENCE_SERVER_PORT || process.argv[process.argv.indexOf("--port") + 1] || 18082);
const host = process.env.REFERENCE_SERVER_HOST || "127.0.0.1";

const types = new Map([
	[".html", "text/html; charset=utf-8"], [".css", "text/css; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
	[".ttf", "font/ttf"], [".otf", "font/otf"], [".woff", "font/woff"], [".woff2", "font/woff2"], [".svg", "image/svg+xml"], [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"], [".gif", "image/gif"], [".ico", "image/x-icon"],
]);

const server = http.createServer(async (request, response) => {
	try {
		const requestUrl = new URL(request.url || "/", `http://${host}`);
		if (requestUrl.pathname === "/healthz") return sendText(response, 200, "ok\n");
		if (requestUrl.pathname.startsWith("/wp-json/sakura/v1/gallery")) {
			const id = [...requestUrl.searchParams.keys(), ...requestUrl.searchParams.values()].find((value) => /^\d+$/.test(value));
			const target = gallery[id] || manifest.wallpaper?.file;
			if (!target) return sendText(response, 404, "missing gallery mapping\n");
			response.writeHead(302, { location: `/${target.replaceAll("\\", "/")}`, "cache-control": "no-store" });
			return response.end();
		}
		let relative = decodeURIComponent(requestUrl.pathname);
		if (relative === "/" || relative === "") relative = "/index.html";
		const candidate = path.resolve(fixtureRoot, `.${relative}`);
		if (candidate !== fixtureRoot && !candidate.startsWith(`${fixtureRoot}${path.sep}`)) return sendText(response, 400, "invalid path\n");
		const body = await fs.readFile(candidate);
		response.writeHead(200, { "content-type": types.get(path.extname(candidate).toLowerCase()) || "application/octet-stream", "cache-control": "no-store", "x-reference-fixture": "frozen" });
		response.end(body);
	} catch (error) {
		if (error?.code === "ENOENT") return sendText(response, 404, "not found\n");
		console.error(error);
		sendText(response, 500, "reference fixture error\n");
	}
});

server.listen(portArgument, host, () => {
	const address = server.address();
	console.log(`REFERENCE_SERVER_READY ${typeof address === "object" ? address.port : portArgument}`);
});

function sendText(response, status, body) {
	response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
	response.end(body);
}

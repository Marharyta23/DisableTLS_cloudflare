const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

app.post("/disable-tls", async (req, res) => {
    const { email, apiKey } = req.body;

    if (!email || !apiKey) {
        return res.status(400).json({ error: "Email и API-ключ обязательны" });
    }

    const headers = {
        "X-Auth-Email": email,
        "X-Auth-Key": apiKey,
        "Content-Type": "application/json"
    };

    try {
        const zonesResponse = await fetch("https://api.cloudflare.com/client/v4/zones", {
            method: "GET",
            headers: headers
        });

        const zonesData = await zonesResponse.json();
        if (!zonesData.success) {
            return res.json({ error: "Ошибка получения зон", details: zonesData.errors });
        }

        const results = [];
        for (const zone of zonesData.result) {
            const url = `https://api.cloudflare.com/client/v4/zones/${zone.id}/settings/tls_1_3`;
            const payload = JSON.stringify({ value: "off" });

            const response = await fetch(url, {
                method: "PATCH",
                headers: headers,
                body: payload
            });

            const responseData = await response.json();
            results.push({ domain: zone.name, success: responseData.success, errors: responseData.errors || null });
        }

        res.json({ results });
    } catch (error) {
        res.status(500).json({ error: "Ошибка сервера", details: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));

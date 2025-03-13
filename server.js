// server.js

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

// ------------------------------------------------------
// Маршрут 1: /disable-tls
// ------------------------------------------------------
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
    // Получаем все зоны (здесь: берем все, если нужно фильтровать - добавьте логику)
    const zonesResponse = await fetch(`${CLOUDFLARE_API_BASE}/zones`, {
      method: "GET",
      headers
    });
    const zonesData = await zonesResponse.json();

    if (!zonesData.success) {
      return res.json({
        error: "Ошибка получения зон",
        details: zonesData.errors
      });
    }

    const results = [];
    for (const zone of zonesData.result) {
      const url = `${CLOUDFLARE_API_BASE}/zones/${zone.id}/settings/tls_1_3`;
      const payload = JSON.stringify({ value: "off" });

      const response = await fetch(url, {
        method: "PATCH",
        headers,
        body: payload
      });
      const responseData = await response.json();
      results.push({
        domain: zone.name,
        success: responseData.success,
        errors: responseData.errors || null
      });
    }

    res.json({ results });
  } catch (error) {
    console.error("Ошибка на /disable-tls:", error);
    res.status(500).json({ error: "Ошибка сервера", details: error.message });
  }
});

// ------------------------------------------------------
// Маршрут 2: /update-a-records
// ------------------------------------------------------
app.post("/update-a-records", async (req, res) => {
  const { email, apiKey, ipAddress, domains } = req.body;

  if (!email || !apiKey || !ipAddress || !Array.isArray(domains)) {
    return res.status(400).json({
      error: "Нужны поля: email, apiKey, ipAddress и массив domains"
    });
  }

  const headers = {
    "X-Auth-Email": email,
    "X-Auth-Key": apiKey,
    "Content-Type": "application/json"
  };

  try {
    const results = [];

    for (const domain of domains) {
      // ищем zoneId для домена
      const zoneId = await getZoneId(domain, headers);
      if (!zoneId) {
        results.push({
          domain,
          error: "Не найден zoneId для данного домена"
        });
        continue;
      }

      // создаём/обновляем A-запись для domain
      const mainResult = await upsertARecord(zoneId, domain, ipAddress, headers);
      // создаём/обновляем A-запись для www.domain
      const wwwResult = await upsertARecord(
        zoneId,
        `www.${domain}`,
        ipAddress,
        headers
      );

      results.push({
        domain,
        mainRecord: mainResult,
        wwwRecord: wwwResult
      });
    }

    res.json({ results });
  } catch (error) {
    console.error("Ошибка на /update-a-records:", error);
    res.status(500).json({ error: "Ошибка сервера", details: error.message });
  }
});

// ------------------------------------------------------
// Запуск сервера
// ------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

// ------------------------------------------------------
// Вспомогательные функции
// ------------------------------------------------------

async function getZoneId(domain, headers) {
  const url = `${CLOUDFLARE_API_BASE}/zones?name=${domain}&status=active`;
  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) {
    throw new Error(`Не удалось получить zone_id для "${domain}": ${res.statusText}`);
  }
  const data = await res.json();
  if (data.success && data.result && data.result.length > 0) {
    return data.result[0].id;
  }
  return null;
}

/**
 * Проверяем, есть ли A-запись для subdomain
 * Если есть -> обновляем, иначе -> создаём
 */
async function upsertARecord(zoneId, subdomain, ipAddress, headers) {
  // сначала findDnsRecord
  const existing = await findDnsRecord(zoneId, subdomain, headers);
  if (existing) {
    // update
    const upd = await updateDnsRecord(zoneId, existing.id, subdomain, ipAddress, headers);
    return { action: "update", subdomain, ipAddress, success: upd.success, errors: upd.errors };
  } else {
    // create
    const crt = await createDnsRecord(zoneId, subdomain, ipAddress, headers);
    return { action: "create", subdomain, ipAddress, success: crt.success, errors: crt.errors };
  }
}

async function findDnsRecord(zoneId, name, headers) {
  const url = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records?type=A&name=${name}`;
  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) {
    throw new Error(`Ошибка при поиске DNS-записей: ${res.statusText}`);
  }
  const data = await res.json();
  if (data.success && data.result && data.result.length > 0) {
    return data.result[0];
  }
  return null;
}

async function createDnsRecord(zoneId, name, ipAddress, headers) {
  const url = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records`;
  const body = {
    type: "A",
    name,
    content: ipAddress,
    ttl: 120,
    proxied: true
  };
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`Ошибка при создании DNS-записи: ${res.statusText}`);
  }
  const data = await res.json();
  return data;
}

async function updateDnsRecord(zoneId, recordId, name, ipAddress, headers) {
  const url = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${recordId}`;
  const body = {
    type: "A",
    name,
    content: ipAddress,
    ttl: 120,
    proxied: true
  };
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`Ошибка при обновлении DNS-записи: ${res.statusText}`);
  }
  const data = await res.json();
  return data;
}

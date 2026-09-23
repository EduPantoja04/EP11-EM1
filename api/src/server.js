const express = require("express");
const { Pool, types } = require("pg");

// Evita que node-pg convierta DATE a objeto Date (desfase de zona horaria).
types.setTypeParser(1082, (value) => value);
types.setTypeParser(1083, (value) => (value ? value.slice(0, 5) : value));

const PORT = Number(process.env.PORT || 3000);

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

pool.on("error", (error) => {
  console.error("Conexión con PostgreSQL interrumpida:", error.message);
});

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toMinutes(hhmm) {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function calcularEstado(data) {
  if (!data.hora_salida_real) return "INCOMPLETO";
  if (toMinutes(data.hora_ingreso_real) > toMinutes(data.hora_ingreso_programada)) {
    return "ATRASO";
  }
  return "PUNTUAL";
}

function validarMarcacion(body, { partial = false } = {}) {
  const errors = [];
  const source = body && typeof body === "object" ? body : {};

  const read = (field) => {
    if (source[field] === undefined || source[field] === null) return "";
    return String(source[field]).trim();
  };

  const data = {
    codigo_empleado: read("codigo_empleado"),
    nombre_empleado: read("nombre_empleado"),
    fecha: read("fecha"),
    hora_ingreso_programada: read("hora_ingreso_programada"),
    hora_ingreso_real: read("hora_ingreso_real"),
    hora_salida_programada: read("hora_salida_programada"),
    hora_salida_real: read("hora_salida_real"),
    observacion: read("observacion"),
  };

  if (!partial || "codigo_empleado" in source) {
    if (!data.codigo_empleado) errors.push("El código de empleado es obligatorio.");
    else if (data.codigo_empleado.length > 20) {
      errors.push("El código de empleado no puede superar 20 caracteres.");
    }
  }

  if (!partial || "nombre_empleado" in source) {
    if (!data.nombre_empleado) errors.push("El nombre del empleado es obligatorio.");
    else if (data.nombre_empleado.length > 120) {
      errors.push("El nombre no puede superar 120 caracteres.");
    }
  }

  if (!partial || "fecha" in source) {
    if (!data.fecha) errors.push("La fecha es obligatoria.");
    else if (!isValidDate(data.fecha)) errors.push("La fecha debe tener formato YYYY-MM-DD.");
  }

  const requiredTimes = [
    ["hora_ingreso_programada", "La hora programada de ingreso"],
    ["hora_ingreso_real", "La hora real de ingreso"],
    ["hora_salida_programada", "La hora programada de salida"],
  ];

  for (const [field, label] of requiredTimes) {
    if (partial && !(field in source)) continue;
    if (!data[field]) errors.push(`${label} es obligatoria.`);
    else if (!TIME_RE.test(data[field])) {
      errors.push(`${label} debe tener formato HH:MM.`);
    }
  }

  if (data.hora_salida_real) {
    if (!TIME_RE.test(data.hora_salida_real)) {
      errors.push("La hora real de salida debe tener formato HH:MM.");
    }
  } else if (!partial || "hora_salida_real" in source) {
    data.hora_salida_real = null;
  }

  if (data.observacion && data.observacion.length > 500) {
    errors.push("La observación no puede superar 500 caracteres.");
  }

  const canCompareProgramadas =
    TIME_RE.test(data.hora_ingreso_programada) && TIME_RE.test(data.hora_salida_programada);
  if (
    canCompareProgramadas &&
    toMinutes(data.hora_salida_programada) < toMinutes(data.hora_ingreso_programada)
  ) {
    errors.push("La hora de salida programada no puede ser anterior a la hora de ingreso programada.");
  }

  const canCompareReales =
    TIME_RE.test(data.hora_ingreso_real) && data.hora_salida_real && TIME_RE.test(data.hora_salida_real);
  if (canCompareReales && toMinutes(data.hora_salida_real) < toMinutes(data.hora_ingreso_real)) {
    errors.push("La hora de salida no puede ser anterior a la hora de ingreso.");
  }

  if (errors.length) return { ok: false, errors };

  data.estado = calcularEstado(data);
  if (!data.observacion) data.observacion = null;
  return { ok: true, data };
}

function mapRow(row) {
  return {
    id: row.id,
    codigo_empleado: row.codigo_empleado,
    nombre_empleado: row.nombre_empleado,
    fecha: row.fecha,
    hora_ingreso_programada: row.hora_ingreso_programada,
    hora_ingreso_real: row.hora_ingreso_real,
    hora_salida_programada: row.hora_salida_programada,
    hora_salida_real: row.hora_salida_real,
    estado: row.estado,
    observacion: row.observacion,
  };
}

async function waitForDatabase() {
  const attempts = 20;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      console.log("Base de datos disponible.");
      return;
    } catch (error) {
      console.log(`Esperando base de datos (${attempt}/${attempts}): ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw new Error("La base de datos no estuvo disponible a tiempo.");
}

const app = express();
app.use(express.json());

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (_error) {
    res.status(500).json({ error: "Base de datos no disponible." });
  }
});

app.get("/api/marcaciones", async (req, res, next) => {
  try {
    const filters = [];
    const values = [];

    if (req.query.empleado !== undefined) {
      const empleado = String(req.query.empleado).trim();
      if (!empleado) {
        return res.status(400).json({ errors: ["El filtro empleado no puede estar vacío."] });
      }
      values.push(empleado);
      filters.push(`codigo_empleado = $${values.length}`);
    }

    if (req.query.fecha !== undefined) {
      const fecha = String(req.query.fecha).trim();
      if (!isValidDate(fecha)) {
        return res.status(400).json({ errors: ["El filtro fecha debe tener formato YYYY-MM-DD."] });
      }
      values.push(fecha);
      filters.push(`fecha = $${values.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT * FROM marcaciones ${where} ORDER BY fecha DESC, id DESC`,
      values
    );
    res.json(result.rows.map(mapRow));
  } catch (error) {
    next(error);
  }
});

app.get("/api/marcaciones/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ errors: ["El id debe ser un entero positivo."] });
    }
    const result = await pool.query("SELECT * FROM marcaciones WHERE id = $1", [id]);
    if (!result.rowCount) {
      return res.status(404).json({ error: "Marcación no encontrada." });
    }
    res.json(mapRow(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.post("/api/marcaciones", async (req, res, next) => {
  try {
    const validation = validarMarcacion(req.body);
    if (!validation.ok) return res.status(400).json({ errors: validation.errors });

    const data = validation.data;
    const result = await pool.query(
      `INSERT INTO marcaciones (
         codigo_empleado, nombre_empleado, fecha,
         hora_ingreso_programada, hora_ingreso_real,
         hora_salida_programada, hora_salida_real,
         estado, observacion
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        data.codigo_empleado,
        data.nombre_empleado,
        data.fecha,
        data.hora_ingreso_programada,
        data.hora_ingreso_real,
        data.hora_salida_programada,
        data.hora_salida_real,
        data.estado,
        data.observacion,
      ]
    );
    res.status(201).json(mapRow(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.put("/api/marcaciones/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ errors: ["El id debe ser un entero positivo."] });
    }

    const existing = await pool.query("SELECT id FROM marcaciones WHERE id = $1", [id]);
    if (!existing.rowCount) {
      return res.status(404).json({ error: "Marcación no encontrada." });
    }

    const validation = validarMarcacion(req.body);
    if (!validation.ok) return res.status(400).json({ errors: validation.errors });

    const data = validation.data;
    const result = await pool.query(
      `UPDATE marcaciones SET
         codigo_empleado = $1,
         nombre_empleado = $2,
         fecha = $3,
         hora_ingreso_programada = $4,
         hora_ingreso_real = $5,
         hora_salida_programada = $6,
         hora_salida_real = $7,
         estado = $8,
         observacion = $9
       WHERE id = $10
       RETURNING *`,
      [
        data.codigo_empleado,
        data.nombre_empleado,
        data.fecha,
        data.hora_ingreso_programada,
        data.hora_ingreso_real,
        data.hora_salida_programada,
        data.hora_salida_real,
        data.estado,
        data.observacion,
        id,
      ]
    );
    res.json(mapRow(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/marcaciones/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ errors: ["El id debe ser un entero positivo."] });
    }
    const result = await pool.query("DELETE FROM marcaciones WHERE id = $1 RETURNING id", [id]);
    if (!result.rowCount) {
      return res.status(404).json({ error: "Marcación no encontrada." });
    }
    res.json({ message: "Marcación eliminada.", id });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ errors: ["El cuerpo de la solicitud no es JSON válido."] });
  }
  console.error(error);
  res.status(500).json({ error: "Error interno del servidor." });
});

waitForDatabase()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`API escuchando en el puerto ${PORT}`);
    });
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });

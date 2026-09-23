const form = document.querySelector("#form-marcacion");
const formTitle = document.querySelector("#form-title");
const formMessage = document.querySelector("#form-message");
const listaMessage = document.querySelector("#lista-message");
const tabla = document.querySelector("#tabla");
const btnGuardar = document.querySelector("#btn-guardar");
const btnCancelar = document.querySelector("#btn-cancelar");
const formFiltro = document.querySelector("#form-filtro");

let editandoId = null;

function setMessage(node, text, kind) {
  node.textContent = text || "";
  node.className = `message${kind ? ` ${kind}` : ""}`;
}

function payloadFromForm() {
  const data = new FormData(form);
  return {
    codigo_empleado: data.get("codigo_empleado"),
    nombre_empleado: data.get("nombre_empleado"),
    fecha: data.get("fecha"),
    hora_ingreso_programada: data.get("hora_ingreso_programada"),
    hora_ingreso_real: data.get("hora_ingreso_real"),
    hora_salida_programada: data.get("hora_salida_programada"),
    hora_salida_real: data.get("hora_salida_real") || null,
    observacion: data.get("observacion") || null,
  };
}

function fillForm(item) {
  editandoId = item.id;
  form.codigo_empleado.value = item.codigo_empleado;
  form.nombre_empleado.value = item.nombre_empleado;
  form.fecha.value = item.fecha;
  form.hora_ingreso_programada.value = item.hora_ingreso_programada;
  form.hora_ingreso_real.value = item.hora_ingreso_real;
  form.hora_salida_programada.value = item.hora_salida_programada;
  form.hora_salida_real.value = item.hora_salida_real || "";
  form.observacion.value = item.observacion || "";
  formTitle.textContent = `Editar marcación #${item.id}`;
  btnGuardar.textContent = "Guardar cambios";
  btnCancelar.classList.remove("hidden");
}

function resetForm() {
  form.reset();
  editandoId = null;
  formTitle.textContent = "Nueva marcación";
  btnGuardar.textContent = "Registrar";
  btnCancelar.classList.add("hidden");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.errors ? body.errors.join(" ") : body.error || "Error al contactar la API.";
    throw new Error(detail);
  }
  return body;
}

function render(items) {
  tabla.replaceChildren();
  if (!items.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.textContent = "No hay marcaciones para mostrar.";
    row.append(cell);
    tabla.append(row);
    return;
  }

  for (const item of items) {
    const row = document.createElement("tr");

    const id = document.createElement("td");
    id.textContent = item.id;

    const empleado = document.createElement("td");
    const nombre = document.createElement("div");
    nombre.textContent = item.nombre_empleado;
    const codigo = document.createElement("div");
    codigo.className = "muted";
    codigo.textContent = item.codigo_empleado;
    empleado.append(nombre, codigo);

    const fecha = document.createElement("td");
    fecha.textContent = item.fecha;

    const ingreso = document.createElement("td");
    ingreso.textContent = `${item.hora_ingreso_real} / ${item.hora_ingreso_programada}`;
    const ingresoHint = document.createElement("div");
    ingresoHint.className = "muted";
    ingresoHint.textContent = "real / programado";
    ingreso.append(ingresoHint);

    const salida = document.createElement("td");
    salida.textContent = `${item.hora_salida_real || "—"} / ${item.hora_salida_programada}`;
    const salidaHint = document.createElement("div");
    salidaHint.className = "muted";
    salidaHint.textContent = "real / programado";
    salida.append(salidaHint);

    const estado = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `badge ${item.estado}`;
    badge.textContent = item.estado;
    estado.append(badge);
    if (item.observacion) {
      const note = document.createElement("div");
      note.className = "muted";
      note.textContent = item.observacion;
      estado.append(note);
    }

    const actions = document.createElement("td");
    const wrap = document.createElement("div");
    wrap.className = "row-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "ghost";
    edit.textContent = "Editar";
    edit.addEventListener("click", () => fillForm(item));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Eliminar";
    remove.addEventListener("click", () => eliminar(item.id));
    wrap.append(edit, remove);
    actions.append(wrap);

    row.append(id, empleado, fecha, ingreso, salida, estado, actions);
    tabla.append(row);
  }
}

async function cargar(query = "") {
  setMessage(listaMessage, "Cargando...");
  try {
    const items = await api(`/api/marcaciones${query}`);
    render(items);
    setMessage(listaMessage, `${items.length} registro(s).`, "ok");
  } catch (error) {
    tabla.replaceChildren();
    setMessage(listaMessage, error.message, "error");
  }
}

async function eliminar(id) {
  if (!confirm(`¿Eliminar la marcación #${id}?`)) return;
  try {
    await api(`/api/marcaciones/${id}`, { method: "DELETE" });
    if (editandoId === id) resetForm();
    setMessage(formMessage, "Marcación eliminada.", "ok");
    await cargar(currentQuery());
  } catch (error) {
    setMessage(formMessage, error.message, "error");
  }
}

function currentQuery() {
  const data = new FormData(formFiltro);
  const params = new URLSearchParams();
  const empleado = String(data.get("empleado") || "").trim();
  const fecha = String(data.get("fecha") || "").trim();
  if (empleado) params.set("empleado", empleado);
  if (fecha) params.set("fecha", fecha);
  const query = params.toString();
  return query ? `?${query}` : "";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(formMessage, "Guardando...");
  try {
    if (editandoId) {
      await api(`/api/marcaciones/${editandoId}`, {
        method: "PUT",
        body: JSON.stringify(payloadFromForm()),
      });
      setMessage(formMessage, "Marcación actualizada. El estado lo calculó la API.", "ok");
    } else {
      const created = await api("/api/marcaciones", {
        method: "POST",
        body: JSON.stringify(payloadFromForm()),
      });
      setMessage(formMessage, `Marcación #${created.id} creada con estado ${created.estado}.`, "ok");
    }
    resetForm();
    await cargar(currentQuery());
  } catch (error) {
    setMessage(formMessage, error.message, "error");
  }
});

btnCancelar.addEventListener("click", () => {
  resetForm();
  setMessage(formMessage, "");
});

formFiltro.addEventListener("submit", (event) => {
  event.preventDefault();
  cargar(currentQuery());
});

document.querySelector("#btn-limpiar").addEventListener("click", () => {
  formFiltro.reset();
  cargar();
});

cargar();

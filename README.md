# Marcaciones de personal (RRHH)

Aplicación multicontenedor para registrar y consultar marcaciones de ingreso y salida. Tres servicios independientes se comunican por una red Docker privada.

```
Usuario → web (nginx, puerto 8090) → api (Express, puerto 3000) → database (PostgreSQL)
```

El navegador solo habla con el contenedor web. Nginx reenvía `/api/` al servicio `api`. La API es el único componente que abre conexión a PostgreSQL. La base de datos no publica puertos hacia el anfitrión.

## Requisitos

- Docker Desktop con Compose v2
- Puertos libres `8090` y `3000`

## Puesta en marcha

```bash
copy .env.example .env
```

Editar `DB_PASSWORD` en `.env`. Ese archivo está en `.gitignore`.

```bash
docker compose up -d
docker ps
```

- Aplicación web: http://localhost:8090
- API REST: http://localhost:3000/api/marcaciones

`api` declara `depends_on` con `condition: service_healthy`. No acepta tráfico hasta que PostgreSQL responde `pg_isready`. Además, al arrancar reintenta la conexión antes de abrir el puerto 3000.

## Variables de entorno

| Variable | Uso |
| --- | --- |
| `DB_HOST` | Nombre DNS del servicio. Debe ser `database`. |
| `DB_PORT` | Puerto interno de PostgreSQL (`5432`). |
| `DB_NAME` | Base `rrhh`. |
| `DB_USER` | Usuario de la base. |
| `DB_PASSWORD` | Contraseña. Solo en `.env`. |

La API no tiene host, puerto, usuario ni clave escritos en el código. Los lee de `process.env`.

## Por qué `database` y no `localhost`

Dentro del contenedor de la API, `localhost` es el propio contenedor de la API. PostgreSQL corre en otro contenedor. Docker Compose registra el nombre del servicio `database` en el DNS de la red `rrhh-net`, así que `database:5432` resuelve a la IP de ese contenedor. Si la API usara `localhost:5432`, intentaría conectarse a sí misma y fallaría.

## Estado automático

La API calcula el estado. El cliente no puede imponerlo.

- Sin hora real de salida: `INCOMPLETO`
- Hora real de ingreso posterior a la programada: `ATRASO`
- Hora real de ingreso igual o anterior a la programada: `PUNTUAL`

Ejemplo del enunciado: programada `08:00` y real `08:12` produce `ATRASO`. Programada `08:00` y real `07:56` produce `PUNTUAL`.

## API

| Método | Ruta | Código |
| --- | --- | --- |
| `POST` | `/api/marcaciones` | `201` / `400` |
| `GET` | `/api/marcaciones` | `200` |
| `GET` | `/api/marcaciones?empleado=EMP001` | `200` / `400` |
| `GET` | `/api/marcaciones?fecha=2026-09-23` | `200` / `400` |
| `GET` | `/api/marcaciones/{id}` | `200` / `404` |
| `PUT` | `/api/marcaciones/{id}` | `200` / `400` / `404` |
| `DELETE` | `/api/marcaciones/{id}` | `200` / `404` |

Un fallo no controlado responde `500`.

Validaciones: código y fecha obligatorios, horas `HH:MM`, fecha real, y la salida no puede ser anterior al ingreso (ni en el horario programado ni en el real).

## Persistencia

El volumen nombrado `rrhh-pgdata` está montado en `/var/lib/postgresql/data`. Borrar el contenedor no borra el volumen. `init.sql` solo corre cuando el volumen está vacío.

```bash
docker compose stop database
docker compose rm -f database
docker compose up -d database
docker compose up -d api
```

Tras recrear `database`, `GET /api/marcaciones` sigue devolviendo los registros.

## Prueba de falla del API

```bash
docker stop rrhh-api
```

La página web sigue sirviendo HTML, pero listar o guardar marcaciones falla porque Nginx no alcanza `api`. `database` sigue en ejecución y conserva los datos.

```bash
docker start rrhh-api
```

Cuando el contenedor vuelve a estar en marcha, la web recupera el listado.

## Health check

```bash
docker inspect --format "{{.State.Health.Status}}" rrhh-database
```

El resultado esperado es `healthy`.

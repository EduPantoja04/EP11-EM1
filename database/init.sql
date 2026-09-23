-- Se ejecuta solo la primera vez que se crea el volumen de datos.
CREATE TABLE IF NOT EXISTS marcaciones (
    id SERIAL PRIMARY KEY,
    codigo_empleado VARCHAR(20) NOT NULL,
    nombre_empleado VARCHAR(120) NOT NULL,
    fecha DATE NOT NULL,
    hora_ingreso_programada TIME NOT NULL,
    hora_ingreso_real TIME NOT NULL,
    hora_salida_programada TIME NOT NULL,
    hora_salida_real TIME,
    estado VARCHAR(20) NOT NULL,
    observacion TEXT,
    CONSTRAINT chk_horas_programadas
        CHECK (hora_salida_programada >= hora_ingreso_programada),
    CONSTRAINT chk_horas_reales
        CHECK (
            hora_salida_real IS NULL
            OR hora_salida_real >= hora_ingreso_real
        )
);

CREATE INDEX IF NOT EXISTS idx_marcaciones_empleado
    ON marcaciones (codigo_empleado);

CREATE INDEX IF NOT EXISTS idx_marcaciones_fecha
    ON marcaciones (fecha);

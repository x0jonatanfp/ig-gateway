import winston from 'winston';

// Un único fichero de aplicación: aplicación y errores van juntos y la rotación
// la hace logrotate. La ruta la fija la unidad con Environment=LOG_FILE.
const logFile = process.env.LOG_FILE ?? '/var/log/ig-gateway.log';

const format = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

export const logger = winston.createLogger({
  level: (process.env.LOG_LEVEL ?? 'info').toLowerCase(),
  format,
  transports: [
    // Todo va a stderr (que el journal recoge igual): stdout queda reservado
    // para la salida de máquina del CLI, que quien publica parsea tal cual.
    // Un aviso suelto por stdout rompía el JSON de la publicación.
    new winston.transports.Console({
      stderrLevels: ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'],
    }),
    new winston.transports.File({ filename: logFile }),
  ],
});

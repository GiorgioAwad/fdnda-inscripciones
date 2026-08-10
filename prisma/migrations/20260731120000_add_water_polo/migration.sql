-- Polo acuático entra como tercera disciplina.
--
-- Va SOLA en esta migración a propósito: PostgreSQL no permite usar un valor de
-- enum recién agregado dentro de la misma transacción que lo agregó, y Prisma
-- corre cada migración en una transacción. La migración siguiente ya puede
-- referirse a 'WATER_POLO'.

ALTER TYPE "Discipline" ADD VALUE 'WATER_POLO';

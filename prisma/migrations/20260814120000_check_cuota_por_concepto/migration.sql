-- El CHECK de agosto seguia atado al enum retirado: exigia athleteFee > 0
-- solo cuando pricingMode = 'PER_ATHLETE'. Con los dos conceptos ya
-- desacoplados, un admin que apaga "Cuota por deportista" en una fila que
-- todavia conserva pricingMode='PER_ATHLETE' (todo evento de clavados)
-- escribe athleteFee=null y viola el CHECK viejo sin motivo real. Ademas,
-- cuando la release siguiente borre la columna pricingMode, Postgres se
-- llevaria este CHECK dependiente en silencio y la garantia desapareceria
-- para siempre. Lo reemplazamos ahora por la version atada a la bandera
-- nueva, que es la que de verdad decide si se cobra la cuota.
--
-- Todas las filas existentes ya la cumplen: chargesAthleteFee se backfillo
-- desde pricingMode en la migracion anterior, y el CHECK viejo ya garantizaba
-- athleteFee > 0 para toda fila PER_ATHLETE. Las instancias viejas, que no
-- escriben chargesAthleteFee (nace en false), tambien la cumplen trivialmente.
ALTER TABLE "event_discipline_configs" DROP CONSTRAINT "event_discipline_configs_athlete_fee_check";
ALTER TABLE "event_discipline_configs" ADD CONSTRAINT "event_discipline_configs_athlete_fee_check"
  CHECK (NOT "chargesAthleteFee" OR ("athleteFee" IS NOT NULL AND "athleteFee" > 0));

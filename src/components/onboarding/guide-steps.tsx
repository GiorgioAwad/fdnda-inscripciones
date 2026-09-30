import type { ReactNode } from "react"
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CalendarRange,
  Check,
  CircleAlert,
  ClipboardList,
  Clock3,
  FileSpreadsheet,
  KeyRound,
  Receipt,
  ShoppingBag,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react"
import { Badge, type BadgeVariant } from "@/components/ui/badge"
import { ORDER_EXPIRATION_MINUTES } from "@/lib/orders"
import { cn } from "@/lib/utils"

// Solo servidor: importa lib/orders (Prisma). El layout arma los pasos y los
// pasa ya renderizados a <GuideProvider>.
//
// Contenido de la guía de bienvenida. Cada paso es una tarea real del producto,
// en el orden en que se hace, y cada afirmación sale del código:
//   - afiliación por temporada y disciplina: lib/affiliations.ts
//   - la cuota entra al carrito al registrar: (portal)/deportistas/actions.ts
//   - la orden se reserva ORDER_EXPIRATION_MINUTES: lib/orders.ts
//   - el club solo ve competencias abiertas de sus disciplinas: lib/club-events.ts
//   - «por conciliar»: countOrdersRequiringPaymentReview, lib/orders.ts
// Si una de esas reglas cambia, este texto tiene que cambiar con ella.

export type GuideRole = "club" | "admin"

export interface GuideStep {
  title: string
  body: ReactNode
  // Dónde vive la tarea, con el mismo nombre e icono que el menú lateral: la
  // guía enseña a encontrarla, no solo a entenderla. El icono va ya renderizado
  // porque todo esto se arma en el servidor y cruza a un componente cliente,
  // y un componente (función) no se puede serializar; un elemento sí.
  place: { label: string; icon: ReactNode }
  visual: ReactNode
}

export const GUIDE_META: Record<
  GuideRole,
  { title: string; finishLabel: string; finishHref: string }
> = {
  club: {
    title: "Cómo afiliar e inscribir a tu club",
    finishLabel: "Ver mis primeros pasos",
    finishHref: "/inicio",
  },
  admin: {
    title: "Cómo poner en marcha una temporada",
    finishLabel: "Ver la puesta en marcha",
    finishHref: "/admin",
  },
}

export const GUIDE_STEPS: Record<GuideRole, GuideStep[]> = {
  club: [
    {
      title: "Afilia a tu club",
      body: (
        <>
          La afiliación se paga una vez por temporada y por cada disciplina de tu
          club. Mientras no esté vigente, no verás las competencias de esa
          disciplina.
        </>
      ),
      place: { label: "Estado de afiliación", icon: <BadgeCheck className="h-4 w-4" /> },
      visual: (
        <MiniCard icon={BadgeCheck} title="Cuota del club" note="Una por disciplina y temporada">
          <StateTrail
            states={[
              ["Sin afiliar", "neutral"],
              ["Pendiente de pago", "warning"],
              ["Vigente", "success"],
            ]}
          />
        </MiniCard>
      ),
    },
    {
      title: "Registra a tus deportistas",
      body: (
        <>
          Búscalos por su número de documento. Revisa la fecha de nacimiento y el
          sexo antes de guardar: después solo la FDNDA puede corregirlos. Con la
          temporada abierta, su afiliación entra sola al carrito.
        </>
      ),
      place: { label: "Padrón", icon: <Users className="h-4 w-4" /> },
      visual: (
        <MiniCard icon={Users} title="Registrar deportista" note="Padrón de tu club">
          <div className="mt-3 flex items-stretch gap-2">
            <span className="flex min-h-10 flex-1 items-center rounded-control border border-fdnda-border-control bg-white px-3 text-xs text-fdnda-muted">
              N.º de documento
            </span>
            <span className="flex items-center rounded-control bg-fdnda-navy px-3 text-xs font-semibold text-white">
              Buscar
            </span>
          </div>
          <ul className="mt-3 space-y-1.5 text-xs text-fdnda-ink">
            {["Fecha de nacimiento", "Sexo"].map((field) => (
              <li key={field} className="flex items-center gap-2">
                <CircleAlert className="h-3.5 w-3.5 shrink-0 text-fdnda-warning" />
                {field}: revísalo antes de guardar
              </li>
            ))}
          </ul>
        </MiniCard>
      ),
    },
    {
      title: "Paga el carrito",
      body: (
        <>
          Al pagar se genera una orden que queda reservada{" "}
          {ORDER_EXPIRATION_MINUTES} minutos para completar el pago con Izipay. Si
          no se paga a tiempo, todo vuelve al carrito. Las afiliaciones valen
          recién cuando la orden queda pagada.
        </>
      ),
      place: { label: "Carrito de afiliación", icon: <ShoppingBag className="h-4 w-4" /> },
      visual: (
        <MiniCard icon={Receipt} title="Orden de afiliación" note="Pago con Izipay">
          <ul className="mt-3 divide-y divide-fdnda-border text-xs">
            <li className="flex justify-between py-1.5">
              <span>Cuota del club</span>
              <span className="text-fdnda-muted">por disciplina</span>
            </li>
            <li className="flex justify-between py-1.5">
              <span>Cuotas de deportistas</span>
              <span className="text-fdnda-muted">por deportista</span>
            </li>
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-fdnda-surface px-2.5 py-1 text-[0.6875rem] font-semibold text-fdnda-navy ring-1 ring-inset ring-fdnda-border">
              <Clock3 className="h-3.5 w-3.5" />
              Reservada {ORDER_EXPIRATION_MINUTES} min
            </span>
            <ArrowRight className="h-3.5 w-3.5 text-fdnda-muted" />
            <Badge variant="success">Pagada</Badge>
          </div>
        </MiniCard>
      ),
    },
    {
      title: "Inscribe en competencias",
      body: (
        <>
          Cada competencia tiene su planilla: agregas deportistas, marcas sus
          pruebas y los cambios se guardan solos. Antes de pagar revisamos
          afiliaciones, edades y cupos. Lo pagado ya no se modifica.
        </>
      ),
      place: { label: "Inscripciones", icon: <ClipboardList className="h-4 w-4" /> },
      visual: (
        <MiniCard icon={ClipboardList} title="Planilla" note="Una por competencia">
          <ol className="mt-3 grid grid-cols-2 gap-1.5 text-[0.6875rem] font-semibold">
            <li className="rounded-chip bg-fdnda-navy px-2 py-1.5 text-white">
              1 · Deportistas y pruebas
            </li>
            <li className="rounded-chip bg-fdnda-surface px-2 py-1.5 text-fdnda-navy ring-1 ring-inset ring-fdnda-border">
              2 · Revisión y pago
            </li>
          </ol>
          <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fdnda-ink">
            {["Afiliación", "Edad", "Cupo"].map((check) => (
              <li key={check} className="flex items-center gap-1">
                <Check className="h-3.5 w-3.5 text-fdnda-success" />
                {check}
              </li>
            ))}
          </ul>
        </MiniCard>
      ),
    },
  ],
  admin: [
    {
      title: "Abre la temporada",
      body: (
        <>
          Crea la temporada con su vigencia y la cuota de afiliación del club y
          por deportista de cada disciplina. Luego hazla vigente: solo puede haber
          una, y sin ella los clubes no pueden afiliarse.
        </>
      ),
      place: { label: "Temporadas y cuotas", icon: <CalendarRange className="h-4 w-4" /> },
      visual: (
        <MiniCard icon={CalendarRange} title="Temporada" note="Cuotas por disciplina">
          <StateTrail
            states={[
              ["Próxima", "neutral"],
              ["Vigente", "success"],
            ]}
          />
        </MiniCard>
      ),
    },
    {
      title: "Da acceso a los clubes",
      body: (
        <>
          Registra cada club y crea su usuario de acceso: coordinador, que ve todo
          el club, o delegado de una sola disciplina. La contraseña se muestra una
          sola vez y el usuario debe cambiarla al entrar.
        </>
      ),
      place: { label: "Clubes", icon: <UsersRound className="h-4 w-4" /> },
      visual: (
        <MiniCard icon={KeyRound} title="Usuario de acceso" note="Uno o más por club">
          <ul className="mt-3 space-y-1.5 text-xs">
            <li className="flex items-center justify-between gap-2">
              <span className="font-semibold text-fdnda-ink">Coordinador del club</span>
              <span className="text-fdnda-muted">todas las disciplinas</span>
            </li>
            <li className="flex items-center justify-between gap-2">
              <span className="font-semibold text-fdnda-ink">Delegado de Clavados</span>
              <span className="text-fdnda-muted">solo Clavados</span>
            </li>
          </ul>
        </MiniCard>
      ),
    },
    {
      title: "Carga el padrón",
      body: (
        <>
          Descarga la plantilla, complétala e impórtala. La vista previa separa
          los deportistas nuevos, los que se actualizarán y las filas con errores.
          Los clubes también pueden registrar deportistas desde su portal.
        </>
      ),
      place: { label: "Padrón", icon: <Users className="h-4 w-4" /> },
      visual: (
        <MiniCard icon={FileSpreadsheet} title="Importar padrón" note="Plantilla en Excel">
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge variant="success">Nuevo</Badge>
            <Badge variant="info">Se actualizará</Badge>
            <Badge variant="danger">Con errores</Badge>
          </div>
        </MiniCard>
      ),
    },
    {
      title: "Publica competencias",
      body: (
        <>
          Crea la competencia en borrador, revisa sus pruebas y abre las
          inscripciones cuando cumpla los requisitos. Los clubes solo la ven
          abierta, en las disciplinas en que están afiliados, y hasta el cierre.
        </>
      ),
      place: { label: "Competencias", icon: <CalendarDays className="h-4 w-4" /> },
      visual: (
        <MiniCard icon={CalendarDays} title="Competencia" note="Pruebas, precios y cierre">
          <StateTrail
            states={[
              ["Borrador", "neutral"],
              ["Inscripciones abiertas", "success"],
            ]}
          />
        </MiniCard>
      ),
    },
    {
      title: "Concilia los pagos",
      body: (
        <>
          Los clubes pagan con Izipay. Si una orden vence con un pago abierto en
          Izipay, queda por conciliar: compruébala en Izipay antes de pedirle al
          club que pague de nuevo.
        </>
      ),
      place: { label: "Órdenes de pago", icon: <Receipt className="h-4 w-4" /> },
      visual: (
        <MiniCard icon={Receipt} title="Orden vencida" note="Con pago abierto en Izipay">
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="warning">Por conciliar</Badge>
            <ArrowRight className="h-3.5 w-3.5 text-fdnda-muted" />
            <span className="text-xs text-fdnda-ink">Verificar en Izipay</span>
          </div>
        </MiniCard>
      ),
    },
  ],
}

// Miniatura de la pantalla real: una tarjeta blanca con el mismo icono en chip
// que usa la interfaz. Es decorativa (aria-hidden en el contenedor): el texto
// del paso ya dice todo lo que muestra.
function MiniCard({
  icon: Icon,
  title,
  note,
  children,
}: {
  icon: LucideIcon
  title: string
  note: string
  children: ReactNode
}) {
  return (
    <div className="w-full max-w-72 rounded-surface border border-fdnda-border bg-white p-4 text-left shadow-floating">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-chip bg-fdnda-sky/40 text-fdnda-navy ring-1 ring-inset ring-fdnda-sky">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-fdnda-navy">{title}</p>
          <p className="truncate text-xs text-fdnda-muted">{note}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function StateTrail({ states }: { states: [string, BadgeVariant][] }) {
  return (
    <ol className="mt-3 flex flex-wrap items-center gap-1.5">
      {states.map(([label, variant], index) => (
        <li key={label} className="flex items-center gap-1.5">
          {index > 0 ? <ArrowRight className={cn("h-3.5 w-3.5 text-fdnda-muted")} /> : null}
          <Badge variant={variant}>{label}</Badge>
        </li>
      ))}
    </ol>
  )
}

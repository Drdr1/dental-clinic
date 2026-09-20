import { whatsappLink } from './phone'

// Messages to patients are always in Egyptian Arabic, whatever language the staff UI uses.
const money = new Intl.NumberFormat('ar-EG-u-nu-latn', { maximumFractionDigits: 2 })
const day = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'long' })
const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full
const fmtDate = (iso: string) => day.format(new Date(`${iso}T12:00:00`))
const when = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })

export function waMessage(phone: string, text: string) {
  return `${whatsappLink(phone)}?text=${encodeURIComponent(text)}`
}

export const templates = {
  installment: (a: { name: string; clinic: string; amount: number; dueDate: string; overdue: boolean }) =>
    a.overdue
      ? `أهلًا ${firstName(a.name)}، ده تذكير من ${a.clinic} إن القسط بتاع ${money.format(a.amount)} ج.م كان ميعاده ${fmtDate(a.dueDate)}. لو دفعته تجاهل الرسالة دي، ولو محتاج أي حاجة كلمنا. شكرًا!`
      : `أهلًا ${firstName(a.name)}، ده تذكير من ${a.clinic} إن القسط بتاع ${money.format(a.amount)} ج.م ميعاده ${fmtDate(a.dueDate)}. شكرًا!`,

  recall: (a: { name: string; clinic: string }) =>
    `أهلًا ${firstName(a.name)}، ده ${a.clinic}. ميعاد الكشف الدوري بتاعك جه، تحب نحجزلك ميعاد الأسبوع ده؟`,

  appointment: (a: { name: string; clinic: string; startsAt: string }) =>
    `أهلًا ${firstName(a.name)}، ده تأكيد لميعادك في ${a.clinic}: ${when.format(new Date(a.startsAt))}. لو محتاج تغيّر الميعاد كلمنا. في انتظارك!`,

  labChase: (a: { clinic: string; description: string; patient: string; sentOn: string; expectedOn: string }) =>
    `السلام عليكم، ده ${a.clinic}. بخصوص شغل (${a.description}) للمريض ${a.patient}، اتبعت يوم ${fmtDate(a.sentOn)} وكان ميعاد تسليمه ${fmtDate(a.expectedOn)}. ياريت تبلغونا هيوصل إمتى. شكرًا!`,

  nextSession: (a: { name: string; clinic: string; plan: string }) =>
    `أهلًا ${firstName(a.name)}، ده ${a.clinic}. خطة العلاج بتاعتك (${a.plan}) لسه فيها جلسات، تحب نحجزلك الجلسة الجاية؟`,
}

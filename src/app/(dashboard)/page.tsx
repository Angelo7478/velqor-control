import { redirect } from 'next/navigation'

// Control Room Velqor Quant: la home porta direttamente alla Overview Quant.
export default function Home() {
  redirect('/divisioni/quant')
}

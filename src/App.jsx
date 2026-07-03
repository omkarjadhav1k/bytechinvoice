import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

const STORAGE_KEY = 'bytech_invoice_settings'
const HISTORY_KEY = 'bytech_invoice_history'
const PDF_SCALE = 3 // higher = crisper PDF text/lines

const defaults = {
  company: 'By Tech Softwares',
  tagline: 'Software Development • Web Solutions • Mobile Apps • IT Consulting',
  address: 'Amravati Road, Nagpur, Maharashtra - 440022, India',
  state: 'Maharashtra (27)',
  gstin: '27DCZPJ3110A1ZT',
  pan: 'DCZPJ3110A',
  sac: '998313 (Software Services)',
  phone: '+91 91580 62839',
  email: 'bytechsoftwares.support@gamil.com',
  website: 'bytechsoftware.vercel.app',
  invNext: 'INV-2026-0001',
  usedInvoices: [],
  bank: '', accName: 'By Tech Softwares', accNo: '', ifsc: '', branch: '', upi: '',
  terms: 'Payment is due within 15 days from the invoice date.\nAll payments are to be made in INR only.\nGST is charged as per Government regulations.\nOnce the service is delivered, it cannot be cancelled or refunded.\nLate payments may attract additional charges.'
}

function money(n) {
  return '₹' + (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(v) {
  if (!v) return '-'
  const [y, m, d] = v.split('-')
  return `${d}-${m}-${y}`
}

function fmtDateTime(ts) {
  const d = new Date(ts)
  return d.toLocaleDateString('en-IN') + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

function bumpInvoiceNo(v) {
  const m = v.match(/^(.*?)(\d+)$/)
  if (!m) return v + '-1'
  const nextNum = (parseInt(m[2], 10) + 1).toString().padStart(m[2].length, '0')
  return m[1] + nextNum
}

function numToWords(num) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  const two = (n) => (n < 20 ? a[n] : b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : ''))
  const three = (n) => (n > 99 ? a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n))
  if (num === 0) return 'Zero'
  let str = ''
  let crore = Math.floor(num / 10000000); num %= 10000000
  let lakh = Math.floor(num / 100000); num %= 100000
  let thousand = Math.floor(num / 1000); num %= 1000
  if (crore) str += three(crore) + ' Crore '
  if (lakh) str += three(lakh) + ' Lakh '
  if (thousand) str += three(thousand) + ' Thousand '
  if (num) str += three(num)
  return str.trim()
}

function computeTotals(items, gstRate, taxType) {
  const sub = items.reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat(it.rate) || 0), 0)
  const rate = parseFloat(gstRate) || 0
  const isInter = taxType === 'inter'
  let cgst = 0, sgst = 0, grand = 0
  if (isInter) {
    sgst = (sub * rate) / 100
    grand = sub + sgst
  } else {
    cgst = (sub * (rate / 2)) / 100
    sgst = (sub * (rate / 2)) / 100
    grand = sub + cgst + sgst
  }
  return { sub, cgst, sgst, grand, rate, isInter }
}

let idCounter = 0
const newRow = () => ({ id: ++idCounter, desc: '', qty: 1, rate: '' })

async function capturePdf(sheetNode, filename) {
  const canvas = await html2canvas(sheetNode, { scale: PDF_SCALE, useCORS: true, allowTaint: true })
  const imgData = canvas.toDataURL('image/png', 1.0)
  const pdf = new jsPDF('p', 'pt', 'a4', true)
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const imgW = pageW
  const imgH = (canvas.height * imgW) / canvas.width
  let heightLeft = imgH, position = 0
  pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH, undefined, 'FAST')
  heightLeft -= pageH
  while (heightLeft > 0) {
    position = heightLeft - imgH
    pdf.addPage()
    pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH, undefined, 'FAST')
    heightLeft -= pageH
  }
  pdf.save(filename)
}

export default function App() {
  const [tab, setTab] = useState('home')
  const [settings, setSettings] = useState(defaults)
  const [history, setHistory] = useState([])
  const [saveNote, setSaveNote] = useState(false)
  const [genNote, setGenNote] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [downloadingId, setDownloadingId] = useState(null)
  const sheetRef = useRef(null)

  // invoice fields
  const [invNo, setInvNo] = useState(defaults.invNext)
  const [invDate, setInvDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState('')
  const [placeSupply, setPlaceSupply] = useState('')
  const [taxType, setTaxType] = useState('intra')
  const [gstRate, setGstRate] = useState(18)
  const [reverseCharge, setReverseCharge] = useState('No')

  const [bill, setBill] = useState({ name: '', contact: '', phone: '', email: '', gstin: '', address: '' })
  const [sameAsBill, setSameAsBill] = useState(true)
  const [ship, setShip] = useState({ name: '', contact: '', phone: '', email: '', gstin: '', address: '' })

  const [items, setItems] = useState([])

  // when set, the off-screen sheet renders this saved invoice instead of the live form (used for history re-download)
  const [historySnapshot, setHistorySnapshot] = useState(null)

  // load settings + history from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const loaded = raw ? { ...defaults, ...JSON.parse(raw) } : defaults
      setSettings(loaded)
      setInvNo(loaded.invNext)
    } catch (e) {
      setSettings(defaults)
    }
    try {
      const rawH = localStorage.getItem(HISTORY_KEY)
      setHistory(rawH ? JSON.parse(rawH) : [])
    } catch (e) {
      setHistory([])
    }
  }, [])

  const persistSettings = (next) => {
    setSettings(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  const persistHistory = (next) => {
    setHistory(next)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  }

  const saveSettingsForm = (formValues) => {
    const next = { ...settings, ...formValues }
    persistSettings(next)
    setInvNo(next.invNext)
    setSaveNote(true)
    setTimeout(() => setSaveNote(false), 1800)
  }

  const addRow = () => setItems((r) => [...r, newRow()])
  const removeRow = (id) => setItems((r) => r.filter((x) => x.id !== id))
  const updateRow = (id, field, value) => setItems((r) => r.map((x) => (x.id === id ? { ...x, [field]: value } : x)))

  const totals = useMemo(() => computeTotals(items, gstRate, taxType), [items, gstRate, taxType])

  const invoiceTaken = settings.usedInvoices && settings.usedInvoices.includes(invNo)

  const clearForm = () => {
    setItems([])
    setBill({ name: '', contact: '', phone: '', email: '', gstin: '', address: '' })
    setShip({ name: '', contact: '', phone: '', email: '', gstin: '', address: '' })
    setSameAsBill(true)
    setPlaceSupply(''); setDueDate('')
    setInvDate(new Date().toISOString().slice(0, 10))
  }

  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    try {
      let current = invNo
      const used = settings.usedInvoices || []
      while (used.includes(current)) current = bumpInvoiceNo(current)
      setInvNo(current)
      setHistorySnapshot(null)

      // wait a tick so the hidden sheet DOM reflects the finalized invoice number
      await new Promise((r) => setTimeout(r, 60))

      await capturePdf(sheetRef.current, `${current}.pdf`)

      const shipFinal = sameAsBill ? bill : ship
      const record = {
        id: `${current}-${Date.now()}`,
        invNo: current,
        invDate, dueDate, placeSupply, taxType, gstRate, reverseCharge,
        items: items.map((it) => ({ ...it })),
        bill: { ...bill },
        ship: { ...shipFinal },
        totals: computeTotals(items, gstRate, taxType),
        settingsSnapshot: { ...settings },
        createdAt: Date.now(),
      }

      const nextUsed = [...used, current]
      const nextInvNext = bumpInvoiceNo(current)
      const nextSettings = { ...settings, usedInvoices: nextUsed, invNext: nextInvNext }
      persistSettings(nextSettings)
      persistHistory([record, ...history])

      setInvNo(nextInvNext)
      setGenNote(true)
      setTimeout(() => setGenNote(false), 1800)
    } catch (e) {
      alert('PDF generation failed: ' + e)
    }
    setGenerating(false)
  }, [invNo, settings, items, bill, ship, sameAsBill, invDate, dueDate, placeSupply, taxType, gstRate, reverseCharge, history])

  const handleRedownload = useCallback(async (record) => {
    setDownloadingId(record.id)
    try {
      setHistorySnapshot(record)
      await new Promise((r) => setTimeout(r, 80))
      await capturePdf(sheetRef.current, `${record.invNo}.pdf`)
    } catch (e) {
      alert('Could not regenerate PDF: ' + e)
    }
    setHistorySnapshot(null)
    setDownloadingId(null)
  }, [])

  // unified data source for the off-screen printable sheet: either a saved history
  // record (with its own settings snapshot) or the live form + current settings
  const sheetData = useMemo(() => {
    if (historySnapshot) {
      const s = historySnapshot
      return {
        settings: s.settingsSnapshot,
        invNo: s.invNo, invDate: s.invDate, dueDate: s.dueDate, placeSupply: s.placeSupply,
        reverseCharge: s.reverseCharge, items: s.items, bill: s.bill, shipEffective: s.ship,
        totals: s.totals,
      }
    }
    return {
      settings, invNo, invDate, dueDate, placeSupply, reverseCharge,
      items, bill, shipEffective: sameAsBill ? bill : ship, totals,
    }
  }, [historySnapshot, settings, invNo, invDate, dueDate, placeSupply, reverseCharge, items, bill, ship, sameAsBill, totals])

  const sac = sheetData.settings.sac ? sheetData.settings.sac.split('(')[0].trim() : '-'
  const qrUrl = sheetData.settings.upi
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
        `upi://pay?pa=${sheetData.settings.upi}&pn=${sheetData.settings.company || ''}&am=${sheetData.totals.grand.toFixed(2)}`
      )}`
    : null
  const termsList = (sheetData.settings.terms || '').split('\n').filter((x) => x.trim())

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <img src="/logo.png" alt="logo" />
          <div>
            <h1>{settings.company || 'Invoice Generator'}</h1>
            <span>{settings.tagline || ''}</span>
          </div>
        </div>
        <div className="tabs">
          <button className={`tab-btn ${tab === 'home' ? 'active' : ''}`} onClick={() => setTab('home')}>Home</button>
          <button className={`tab-btn ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>History</button>
          <button className={`tab-btn ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>Settings</button>
        </div>
      </div>

      {tab === 'home' && (
        <>
          <div className="card">
            <h2>Invoice Details</h2>
            <div className="grid g3">
              <div className="field">
                <label>Invoice No.</label>
                <div className="inv-no-row">
                  <input value={invNo} onChange={(e) => setInvNo(e.target.value)} placeholder="INV-2026-0001" />
                  <button className="refresh-btn" title="Reset to next suggested number" onClick={() => setInvNo(settings.invNext)}>↻</button>
                </div>
                {invoiceTaken && <div className="taken-warn">This number is already used — it will auto-advance on generate.</div>}
              </div>
              <div className="field"><label>Invoice Date</label><input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} /></div>
              <div className="field"><label>Due Date</label><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
              <div className="field"><label>Place of Supply</label><input value={placeSupply} onChange={(e) => setPlaceSupply(e.target.value)} placeholder="e.g. Maharashtra (27)" /></div>
              <div className="field">
                <label>Tax Type</label>
                <select value={taxType} onChange={(e) => setTaxType(e.target.value)}>
                  <option value="intra">Intra-state (CGST + SGST)</option>
                  <option value="inter">Inter-state (IGST)</option>
                </select>
              </div>
              <div className="field"><label>GST Rate (%)</label><input type="number" min="0" value={gstRate} onChange={(e) => setGstRate(e.target.value)} /></div>
              <div className="field">
                <label>Reverse Charge</label>
                <select value={reverseCharge} onChange={(e) => setReverseCharge(e.target.value)}>
                  <option value="No">No</option>
                  <option value="Yes">Yes</option>
                </select>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Bill To</h2>
            <div className="grid">
              <div className="field"><label>Client Name</label><input value={bill.name} onChange={(e) => setBill({ ...bill, name: e.target.value })} placeholder="Client Pvt. Ltd." /></div>
              <div className="field"><label>Contact Person</label><input value={bill.contact} onChange={(e) => setBill({ ...bill, contact: e.target.value })} /></div>
              <div className="field"><label>Phone</label><input value={bill.phone} onChange={(e) => setBill({ ...bill, phone: e.target.value })} /></div>
              <div className="field"><label>Email</label><input value={bill.email} onChange={(e) => setBill({ ...bill, email: e.target.value })} /></div>
              <div className="field"><label>GSTIN</label><input value={bill.gstin} onChange={(e) => setBill({ ...bill, gstin: e.target.value })} /></div>
              <div className="field"><label>Address</label><input value={bill.address} onChange={(e) => setBill({ ...bill, address: e.target.value })} /></div>
            </div>
          </div>

          <div className="card">
            <h2>
              Ship / Service To
              <label className="checkline">
                <input type="checkbox" checked={sameAsBill} onChange={(e) => setSameAsBill(e.target.checked)} style={{ width: 'auto' }} /> Same as Bill To
              </label>
            </h2>
            {!sameAsBill && (
              <div className="grid">
                <div className="field"><label>Client Name</label><input value={ship.name} onChange={(e) => setShip({ ...ship, name: e.target.value })} /></div>
                <div className="field"><label>Contact Person</label><input value={ship.contact} onChange={(e) => setShip({ ...ship, contact: e.target.value })} /></div>
                <div className="field"><label>Phone</label><input value={ship.phone} onChange={(e) => setShip({ ...ship, phone: e.target.value })} /></div>
                <div className="field"><label>Email</label><input value={ship.email} onChange={(e) => setShip({ ...ship, email: e.target.value })} /></div>
                <div className="field"><label>GSTIN</label><input value={ship.gstin} onChange={(e) => setShip({ ...ship, gstin: e.target.value })} /></div>
                <div className="field"><label>Address</label><input value={ship.address} onChange={(e) => setShip({ ...ship, address: e.target.value })} /></div>
              </div>
            )}
          </div>

          <div className="card">
            <h2>Description of Services</h2>
            <table className="items">
              <thead>
                <tr>
                  <th className="col-sr">Sr</th><th>Description</th><th className="col-qty">Qty</th><th className="col-rate">Rate (₹)</th><th className="col-amt">Amount (₹)</th><th className="col-del"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.id}>
                    <td className="col-sr">{i + 1}</td>
                    <td><input value={it.desc} onChange={(e) => updateRow(it.id, 'desc', e.target.value)} placeholder="Service description" /></td>
                    <td className="col-qty"><input type="number" min="0" value={it.qty} onChange={(e) => updateRow(it.id, 'qty', e.target.value)} /></td>
                    <td className="col-rate"><input type="number" min="0" value={it.rate} onChange={(e) => updateRow(it.id, 'rate', e.target.value)} /></td>
                    <td className="col-amt">{money((parseFloat(it.qty) || 0) * (parseFloat(it.rate) || 0))}</td>
                    <td className="col-del"><button className="del-btn" onClick={() => removeRow(it.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {items.length === 0 && <div className="empty-hint">No line items yet — click below to add your first service.</div>}
            <button className="add-row" onClick={addRow}>+ Add line item</button>

            <div className="totals">
              <div className="totals-row"><span>Subtotal</span><span>{money(totals.sub)}</span></div>
              {totals.isInter ? (
                <div className="totals-row"><span>IGST @ {totals.rate}%</span><span>{money(totals.sgst)}</span></div>
              ) : (
                <>
                  <div className="totals-row"><span>CGST @ {totals.rate / 2}%</span><span>{money(totals.cgst)}</span></div>
                  <div className="totals-row"><span>SGST @ {totals.rate / 2}%</span><span>{money(totals.sgst)}</span></div>
                </>
              )}
              <div className="totals-row grand"><span>Grand Total</span><span>{money(totals.grand)}</span></div>
            </div>
            {totals.grand > 0 && <div className="words">Amount in Words: {numToWords(Math.round(totals.grand))} Rupees Only</div>}
          </div>

          <div className="actions">
            <button className="btn btn-primary" disabled={generating} onClick={handleGenerate}>{generating ? 'Generating...' : 'Generate PDF'}</button>
            <button className="btn btn-ghost" onClick={clearForm}>Clear form</button>
            <span className={`save-note ${genNote ? 'show' : ''}`}>PDF downloaded ✓</span>
          </div>
        </>
      )}

      {tab === 'history' && (
        <HistoryTab history={history} onRedownload={handleRedownload} downloadingId={downloadingId} />
      )}

      {tab === 'settings' && (
        <SettingsForm settings={settings} onSave={saveSettingsForm} saveNote={saveNote} />
      )}

      {/* off-screen printable sheet used for PDF capture — driven by sheetData
          (live form, or a saved history record when re-downloading) */}
      <div id="sheet-wrap">
        <div id="sheet" ref={sheetRef}>
          <div className="dots"></div>
          <div className="head">
            <div className="head-left">
              <img src="/logo.png" alt="logo" />
              <div>
                <div className="lname">{sheetData.settings.company}</div>
                <div className="ltag">{sheetData.settings.tagline}</div>
              </div>
            </div>
            <div className="head-right">
              <h1>TAX INVOICE</h1>
              <div className="rule"></div>
            </div>
          </div>
          <div className="divider"></div>

          <div className="infobar">
            <div className="infobox">
              <div className="row"><b>Address</b><span>{sheetData.settings.address || '-'}</span></div>
              <div className="row"><b>Phone</b><span>{sheetData.settings.phone || '-'}</span></div>
              <div className="row"><b>Email</b><span>{sheetData.settings.email || '-'}</span></div>
            </div>
            <div className="infobox">
              <div className="row"><b>GSTIN</b><span>{sheetData.settings.gstin || '-'}</span></div>
              <div className="row"><b>State</b><span>{sheetData.settings.state || '-'}</span></div>
              <div className="row"><b>PAN</b><span>{sheetData.settings.pan || '-'}</span></div>
              <div className="row"><b>SAC Code</b><span>{sheetData.settings.sac || '-'}</span></div>
            </div>
            <div className="invbox">
              <div className="ihead"><span>Invoice No.</span><span className="num">{sheetData.invNo}</span></div>
              <div className="irow"><span>Invoice Date</span><span>{fmtDate(sheetData.invDate)}</span></div>
              <div className="irow"><span>Due Date</span><span>{fmtDate(sheetData.dueDate)}</span></div>
              <div className="irow"><span>Place of Supply</span><span>{sheetData.placeSupply || '-'}</span></div>
              <div className="irow" style={{ borderBottom: 'none' }}><span>Reverse Charge</span><span>{sheetData.reverseCharge}</span></div>
            </div>
          </div>

          <div className="bt-wrap">
            <div className="bt">
              <h3>BILL TO</h3>
              <div className="body">
                <b>Client</b>{sheetData.bill.name || '-'}<br />
                <b>Contact</b>{sheetData.bill.contact || '-'}<br />
                <b>Address</b>{sheetData.bill.address || '-'}<br />
                <b>GSTIN</b>{sheetData.bill.gstin || '-'}<br />
                <b>Phone</b>{sheetData.bill.phone || '-'}<br />
                <b>Email</b>{sheetData.bill.email || '-'}
              </div>
            </div>
            <div className="bt">
              <h3 className="gold">SHIP / SERVICE TO</h3>
              <div className="body">
                <b>Client</b>{sheetData.shipEffective.name || '-'}<br />
                <b>Contact</b>{sheetData.shipEffective.contact || '-'}<br />
                <b>Address</b>{sheetData.shipEffective.address || '-'}<br />
                <b>GSTIN</b>{sheetData.shipEffective.gstin || '-'}<br />
                <b>Phone</b>{sheetData.shipEffective.phone || '-'}<br />
                <b>Email</b>{sheetData.shipEffective.email || '-'}
              </div>
            </div>
          </div>

          <table className="items2">
            <thead>
              <tr><th className="ctr">Sr</th><th>Description</th><th className="ctr">SAC</th><th className="ctr">Qty</th><th className="num">Rate (₹)</th><th className="num">Amount (₹)</th></tr>
            </thead>
            <tbody>
              {sheetData.items.map((it, i) => (
                <tr key={it.id || i}>
                  <td className="ctr">{i + 1}</td>
                  <td>{it.desc || '-'}</td>
                  <td className="ctr">{sac}</td>
                  <td className="ctr">{it.qty}</td>
                  <td className="num">{(parseFloat(it.rate) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className="num">{money((parseFloat(it.qty) || 0) * (parseFloat(it.rate) || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="bottom-row">
            <div className="words-box">
              <h3>AMOUNT IN WORDS</h3>
              <p>{sheetData.totals.grand > 0 ? numToWords(Math.round(sheetData.totals.grand)) + ' Rupees Only' : '-'}</p>
            </div>
            <div className="totalsbox">
              <div><span>Subtotal</span><span>{money(sheetData.totals.sub)}</span></div>
              {sheetData.totals.isInter ? (
                <div><span>IGST @ {sheetData.totals.rate}%</span><span>{money(sheetData.totals.sgst)}</span></div>
              ) : (
                <>
                  <div><span>CGST @ {sheetData.totals.rate / 2}%</span><span>{money(sheetData.totals.cgst)}</span></div>
                  <div><span>SGST @ {sheetData.totals.rate / 2}%</span><span>{money(sheetData.totals.sgst)}</span></div>
                </>
              )}
              <div className="grand"><span>GRAND TOTAL</span><span>{money(sheetData.totals.grand)}</span></div>
            </div>
          </div>

          <div className="pay4">
            <div className="col">
              <h4>Payment Details</h4>
              Bank Name: {sheetData.settings.bank || '-'}<br />
              Account Name: {sheetData.settings.accName || '-'}<br />
              Account No.: {sheetData.settings.accNo || '-'}<br />
              IFSC Code: {sheetData.settings.ifsc || '-'}<br />
              Branch: {sheetData.settings.branch || '-'}<br />
              UPI ID: {sheetData.settings.upi || '-'}
            </div>
            <div className="col qr">
              <h4>Scan &amp; Pay (UPI)</h4>
              {qrUrl ? <img src={qrUrl} crossOrigin="anonymous" alt="upi qr" /> : <div style={{ fontSize: 10, color: '#999', padding: '20px 0' }}>Add UPI ID in Settings</div>}
              <div>{sheetData.settings.upi || ''}</div>
            </div>
            <div className="col terms">
              <h4>Terms &amp; Conditions</h4>
              <ul>{termsList.map((t, i) => <li key={i}>✔ {t}</li>)}</ul>
            </div>
            <div className="col sign">
              <h4>Authorized Signatory</h4>
              <div style={{ fontSize: 10, marginTop: 6 }}>For {sheetData.settings.company}</div>
              <div className="script">{(sheetData.settings.company || '').split(' ')[0]}</div>
              <div className="line">Authorized Signatory</div>
            </div>
          </div>

          <div className="footerbar">
            <div><span className="dot"></span>Quality Services</div>
            <div><span className="dot"></span>On-Time Delivery</div>
            <div><span className="dot"></span>24/7 Support</div>
            <div><span className="dot"></span>Client Satisfaction</div>
          </div>
          <div className="thanks">Thank you for your business!</div>
        </div>
      </div>
    </div>
  )
}

function HistoryTab({ history, onRedownload, downloadingId }) {
  return (
    <div className="card">
      <h2>Past Invoices<span className="badge">{history.length} saved</span></h2>
      {history.length === 0 ? (
        <div className="empty-hint">No invoices generated yet. Invoices you generate on the Home tab will show up here for future reference.</div>
      ) : (
        <table className="items history-table">
          <thead>
            <tr>
              <th>Invoice No</th><th>Date</th><th>Client</th><th className="col-amt">Amount</th><th>Generated</th><th className="col-del"></th>
            </tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <tr key={r.id}>
                <td><b>{r.invNo}</b></td>
                <td>{fmtDate(r.invDate)}</td>
                <td>{r.bill?.name || '-'}</td>
                <td className="col-amt">{money(r.totals?.grand)}</td>
                <td style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDateTime(r.createdAt)}</td>
                <td>
                  <button className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }} disabled={downloadingId === r.id} onClick={() => onRedownload(r)}>
                    {downloadingId === r.id ? '...' : 'Download PDF'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="hint" style={{ marginTop: 14 }}>Saved on this device/browser only (localStorage) — clearing browser data will remove this history.</div>
    </div>
  )
}

function SettingsForm({ settings, onSave, saveNote }) {
  const [form, setForm] = useState(settings)
  useEffect(() => setForm(settings), [settings])
  const upd = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  return (
    <>
      <div className="card">
        <h2>Business Details<span className="badge">Auto-fills every invoice</span></h2>
        <div className="grid">
          <div className="field"><label>Company Name</label><input value={form.company} onChange={upd('company')} /></div>
          <div className="field"><label>Tagline</label><input value={form.tagline} onChange={upd('tagline')} /></div>
          <div className="field"><label>Address</label><input value={form.address} onChange={upd('address')} /></div>
          <div className="field"><label>State (with code)</label><input value={form.state} onChange={upd('state')} placeholder="Maharashtra (27)" /></div>
          <div className="field"><label>GSTIN</label><input value={form.gstin} onChange={upd('gstin')} /></div>
          <div className="field"><label>PAN</label><input value={form.pan} onChange={upd('pan')} /></div>
          <div className="field"><label>SAC Code</label><input value={form.sac} onChange={upd('sac')} placeholder="998313 (Software Services)" /></div>
          <div className="field"><label>Phone</label><input value={form.phone} onChange={upd('phone')} /></div>
          <div className="field"><label>Email</label><input value={form.email} onChange={upd('email')} /></div>
          <div className="field"><label>Website</label><input value={form.website} onChange={upd('website')} /></div>
          <div className="field">
            <label>Next Invoice Number</label>
            <input value={form.invNext} onChange={upd('invNext')} placeholder="INV-2026-0001" />
            <div className="subhint">Used to suggest the next invoice number on the Home tab.</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Payment Details</h2>
        <div className="grid g3">
          <div className="field"><label>Bank Name</label><input value={form.bank} onChange={upd('bank')} /></div>
          <div className="field"><label>Account Name</label><input value={form.accName} onChange={upd('accName')} /></div>
          <div className="field"><label>Account No.</label><input value={form.accNo} onChange={upd('accNo')} /></div>
          <div className="field"><label>IFSC</label><input value={form.ifsc} onChange={upd('ifsc')} /></div>
          <div className="field"><label>Branch</label><input value={form.branch} onChange={upd('branch')} /></div>
          <div className="field"><label>UPI ID</label><input value={form.upi} onChange={upd('upi')} placeholder="name@upi" /></div>
        </div>
      </div>

      <div className="card">
        <h2>Terms &amp; Conditions</h2>
        <div className="field"><textarea value={form.terms} onChange={upd('terms')} /></div>
        <div className="hint">One line per rule — shown as a checklist on the invoice.</div>
      </div>

      <div className="actions">
        <button className="btn btn-primary" onClick={() => onSave(form)}>Save settings</button>
        <span className={`save-note ${saveNote ? 'show' : ''}`}>Saved ✓</span>
      </div>
    </>
  )
}

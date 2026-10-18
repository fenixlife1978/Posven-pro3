# **App Name**: LicorPOS Elite

## Core Features:

- Smart Barcode Engine: System-wide barcode detection optimized for HID USB devices (like BARCODER), featuring a specialized listener to auto-detect hardware and focus inputs for rapid product registration or sales.
- Omni-Payment POS Terminal: An exact replica of the requested selling interface featuring a shopping cart, instant subtotal calculation in both local currency (BS) and USD, and multiple payment method processing (Biopago, Zelle, etc).
- Live Stock Guardian: Full inventory management module that updates stock levels in real-time as sales are processed, including low-stock alerts and categorization for various spirits and beverages.
- Customer Credit & Debt Tracker: A financial module to manage client profiles and track balances for 'on-credit' sales, including payment history and automated balance adjustment.
- Cashier Session Controller: Secure opening and closing logic for daily shifts to ensure cash accountability, tracking differences between expected totals and actual counted amounts.
- AI Sales Intel Tool: Generative AI tool that analyzes sales patterns from your transaction history to provide restocking recommendations and weekly revenue forecasts.
- Digital Receipt Generator: Instant creation of virtual sales receipts formatted for both 80mm thermal printers and PDF exports.

## Style Guidelines:

- Dark mode theme: Primary color is a deep Sapphire Navy (#1E2140) and background is a heavily desaturated Midnight Ink (#0E0F16). These choices minimize eye strain during long cashier shifts.
- Accent color is a vibrant Amethyst Purple (#6B5FD4) used for active states and critical 'Add to Cart' actions.
- The objective and machined 'Inter' sans-serif for UI labels and currency amounts, paired with 'Source Code Pro' for high-readability barcode numbers and system identifiers.
- Clean, monochrome stroke icons that prioritize clarity, using a distinct glass-morphism style for tooltips and badges.
- Three-column dashboard for POS (Search-Cart-Summary) which collapses into a single-column flow on smaller terminals to maintain high operational speed.
- Swift 'slide-down' transitions when items enter the cart and micro-scale interactions on barcode-read success to provide visual confirmation of scans.
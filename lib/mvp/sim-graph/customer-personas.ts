export interface CustomerPersona {
  id: string;
  title: string;
  name: string;
  company: string;
  role: string;
  temperament: string;
  issue: string;
  openingLine: string;
  hiddenFacts: Record<string, string>;
}

export const PERSONAS: Record<string, CustomerPersona> = {
  'outlook-basic': {
    id: 'outlook-basic',
    title: 'Outlook Not Sending',
    name: 'Sarah Thompson',
    company: 'Northvale Dental',
    role: 'Practice Manager',
    temperament: 'stressed',
    issue: 'Outlook stuck in offline mode after a password change',
    openingLine: "Hi, I'm having trouble with my Outlook — it's not sending emails. I really need to get this sorted quickly.",
    hiddenFacts: {
      hostname: 'NVDT-LT-045',
      workaround: 'Outlook Web App works fine',
      recentChange: 'IT reset the domain password yesterday',
      domain: 'nvdental.local',
    },
  },
  'vpn-triage': {
    id: 'vpn-triage',
    title: 'VPN Connection Issue',
    name: 'James Carter',
    company: 'Alder & Co Solicitors',
    role: 'Solicitor',
    temperament: 'frustrated',
    issue: 'VPN client version mismatch after Windows update',
    openingLine: "I can't connect to the VPN since the update last night. I have a client meeting in an hour.",
    hiddenFacts: {
      vpnClient: 'OpenConnect v3.1',
      osVersion: 'Windows 11 24H2',
      workaround: 'Browser-based portal access works',
      recentChange: 'Windows Update KB5053651 installed automatically',
    },
  },
  'printer-down': {
    id: 'printer-down',
    title: 'Printer Not Working',
    name: 'Maria Costa',
    company: 'Brighton Community Health',
    role: 'Receptionist',
    temperament: 'anxious',
    issue: 'Printer queue is stalled after a paper jam was cleared incorrectly',
    openingLine: "The main reception printer has stopped working. Patients are waiting and I need this fixed urgently.",
    hiddenFacts: {
      printerModel: 'HP LaserJet Pro M404dn',
      ipAddress: '10.0.15.42',
      errorDisplayed: 'Access Denied — unable to connect',
      workaround: 'USB-connected backup printer in back office works',
      recentChange: 'Paper jam cleared by staff this morning',
    },
  },
  'phishing-report': {
    id: 'phishing-report',
    title: 'Suspicious Email Reported',
    name: 'David Chen',
    company: 'Meridian Finance',
    role: 'Financial Analyst',
    temperament: 'worried',
    issue: 'Potential phishing email targeting finance department',
    openingLine: "I got an email that looks like it's from the CEO asking me to transfer funds urgently. I didn't click anything but I'm worried.",
    hiddenFacts: {
      senderDisplay: 'CEO Sarah Mitchell <sarah.mitchell@meridian-finance.com>',
      actualSender: 's.mitchell@meridian-f1nance.com (typo-squatted domain)',
      emailSubject: 'Urgent: Vendor Payment Required Today',
      targetSystems: 'Company finance system (Xero)',
      otherStaffReceived: 'Three other analysts in finance also reported it',
    },
  },
};

export function getPersona(id: string): CustomerPersona {
  return PERSONAS[id] || PERSONAS['outlook-basic'];
}

export function defaultPersona(): CustomerPersona {
  return PERSONAS['outlook-basic'];
}

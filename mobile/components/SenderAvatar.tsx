import React, { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';

const AVATAR_COLORS = [
  '#ef4444','#f97316','#f59e0b','#eab308',
  '#84cc16','#22c55e','#10b981','#14b8a6',
  '#06b6d4','#0ea5e9','#3b82f6','#6366f1',
  '#8b5cf6','#a855f7','#d946ef','#ec4899',
];

function getAvatarColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name[0].toUpperCase();
  }
  return email[0].toUpperCase();
}

function getFaviconUrl(emailAddress: string): string {
  const domain = emailAddress.split('@')[1] ?? '';
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

interface Props {
  fromEmail: string;
  fromName: string;
  size?: number;
}

export default function SenderAvatar({ fromEmail, fromName, size = 36 }: Props) {
  const [faviconLoaded, setFaviconLoaded] = useState(false);
  const [faviconError, setFaviconError] = useState(false);
  const faviconUrl = getFaviconUrl(fromEmail);
  const initials = getInitials(fromName, fromEmail);
  const bgColor = getAvatarColor(fromEmail);
  const radius = size / 2;

  return (
    <View style={{ width: size, height: size, borderRadius: radius, flexShrink: 0 }}>
      {!faviconError && (
        <Image
          source={{ uri: faviconUrl }}
          style={[
            { width: size, height: size, borderRadius: radius },
            !faviconLoaded && { position: 'absolute', opacity: 0 },
          ]}
          onLoad={() => setFaviconLoaded(true)}
          onError={() => setFaviconError(true)}
        />
      )}
      {(!faviconLoaded || faviconError) && (
        <View style={[
          StyleSheet.absoluteFill,
          { borderRadius: radius, backgroundColor: bgColor, justifyContent: 'center', alignItems: 'center' },
        ]}>
          <Text style={{ color: '#fff', fontSize: size * 0.38, fontWeight: '700' }}>{initials}</Text>
        </View>
      )}
    </View>
  );
}

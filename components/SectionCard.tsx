import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface SectionCardProps {
  title: string;
  content: string;
}

export default function SectionCard({ title, content }: SectionCardProps) {
  if (!title) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {content ? <Text style={styles.content}>{content}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#071427',
    borderRadius: 16,
    padding: 14,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(212,168,67,0.15)',
  },
  title: {
    color: '#FFD06A',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  content: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 21,
  },
});

import { StyleSheet } from 'react-native';
import AnnotationEditor from '@/components/annotation-editor';
import { ThemedView } from '@/components/themed-view';

export default function AnnotationScreen() {
  return (
    <ThemedView style={styles.container}>
      <AnnotationEditor />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

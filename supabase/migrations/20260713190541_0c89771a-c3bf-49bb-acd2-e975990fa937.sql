
CREATE POLICY "Authenticated can read chat photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'chat-photos');
CREATE POLICY "Authenticated can upload chat photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users can delete own chat photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'chat-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

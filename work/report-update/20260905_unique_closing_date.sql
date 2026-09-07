-- Menjamin hanya ada satu snapshot closing untuk setiap tanggal.
ALTER TABLE tb_closingan
  ADD UNIQUE KEY uq_tb_closingan_tanggal (tanggal);

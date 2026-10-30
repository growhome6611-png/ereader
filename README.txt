E-READER PRO V17 - LUU BAN DICH CAU VING VIEN
==============================================
Moi V17:
- Dịch một câu sẽ lưu ngay vào IndexedDB trên thiết bị, độc lập với tiến độ đọc.
- Mở lại ứng dụng/chương: bản dịch đã hiển thị sẽ tự xuất hiện (hoặc tiếp tục ẩn nếu người đọc chủ động ẩn).
- Nút dịch câu đã lưu chuyển thành Hien ban dich / An ban dich: không gọi API thêm.
- Nếu câu giống nhau xuất hiện ở phần khác, ưu tiên lấy lại bản dịch cùng chiều từ cache trước khi gọi API.
- Tương thích với dữ liệu bản dịch đã lưu theo kiểu V7-V16.
- Lưu ngay khi dịch thành công, và xếp hàng các bản ghi trạng thái tránh lưu ngược bản cũ.
- Thay đổi chiều dịch trong Cài đặt sẽ tải lại chương, không hiển thị nhầm bản dịch của ngôn ngữ khác.
- Chỉ có dữ liệu trên trình duyệt và thiết bị hiện tại; không đồng bộ giữa điện thoại/máy tính.

CAP NHAT GITHUB/VERCEL:
Giai nen ZIP; dua noi dung cac tep va hai thu muc api, icons vao goc repository; commit.
Khong xoa du lieu trang web tren dien thoai; viec xoa du lieu trinh duyet se xoa sach da luu va ban dich.
Ban HTML doc lap can ket noi Internet de tai cac thu vien, dich qua API tuy cau hinh.

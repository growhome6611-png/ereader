E-Reader Pro V21 – Chu thich, to mau va tu dien rut gon

Cap nhat GitHub / Vercel: upload cac tep trong ZIP nay vao GOC repository va giu thu muc api/, icons/.
Khong ghi de tep drive-config.js da co Client ID tren GitHub (goi ZIP khong chua tep nay).

Diem moi:
- Boi den mot doan trong cung mot cau -> To mau (4 mau) / Ghi chu.
- Chuyen sang tab Ghi chu de tim lai, sua hoac xoa ghi chu.
- Khi tra tu, xem ban tom tat; nhan Xem them de mo thong tin IPA, ngu nghia, vi du va dong/trai nghia.
- Sua popup bi tran mep man hinh Android, dac biet mobile selection menu truoc day thua ke transformX(-50%).
- Cai thien luong tiep tuc dang nhap Google: nho email/tai khoan; lan sau cap lai quyen Drive bang 1 lan cham khi token het han. Co nut Doi tai khoan.

Luu y quan trong ve Google Drive:
OAuth 2.0 GIS token browser model co access token ngan han. Google KHONG ho tro duyet website co quyen Drive vo thoi han bang cach chi luu ID/email. Khi het han phai xin quyen lai qua thao tac nguoi dung. Ban moi giu du lieu doc sach/cac ban ghi offline va giup tiep tuc Google nhanh hon, nhung KHONG the dam bao khong bao gio hien hop thoai Google. Dong bo Drive that su tu dong khi khong can nguoi dung can backend auth code flow va refresh token luu an toan. Tuyet doi khong luu refresh token/client secret trong JS hoac GitHub.

To mau va ghi chu duoc luu trong book state va dong bo theo Google Drive khi xac thuc. Chi ho tro chon phan van ban trong mot cau; doan cat qua nhieu cau can chon tung cau.
